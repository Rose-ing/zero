package agent

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

// IntakeResult is the outcome of a single turn of the intake conversation.
// Either Reply is set (another question for the user) or SearchParams is set
// (enough info gathered — caller should run the Places search).
type IntakeResult struct {
	Reply        string                 `json:"reply,omitempty"`
	Options      []string               `json:"options,omitempty"`
	SearchParams map[string]interface{} `json:"search_params,omitempty"`
	Done         bool                   `json:"done"`
}

type intakeTool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"input_schema"`
}

type intakeRequest struct {
	Model     string       `json:"model"`
	MaxTokens int          `json:"max_tokens"`
	System    string       `json:"system"`
	Messages  []Message    `json:"messages"`
	Tools     []intakeTool `json:"tools"`
}

type contentBlock struct {
	Type  string                 `json:"type"`
	Text  string                 `json:"text,omitempty"`
	ID    string                 `json:"id,omitempty"`
	Name  string                 `json:"name,omitempty"`
	Input map[string]interface{} `json:"input,omitempty"`
}

type intakeResponse struct {
	Content    []contentBlock `json:"content"`
	StopReason string         `json:"stop_reason"`
	Error      *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

const intakeSystemPrompt = `Sos el agente de intake de Zero, una plataforma que busca leads (clientes potenciales) de negocios en Google Maps para nuestros clientes.

Tu rol:
1. El usuario te va a decir qué producto/servicio vende.
2. Tenés que hacer entre 2 y 4 preguntas cortas y puntuales para entender:
   - Qué tipo de comercio/negocio es el cliente ideal.
   - En qué zona geográfica buscar.
   - (Opcional) filtros de calidad.
3. Una vez que tengas CLARO el tipo de comercio y la zona, llamás a la tool "search_places" con los parámetros.

REGLA CRÍTICA — cómo preguntar:
- NUNCA escribas preguntas como texto libre. SIEMPRE usá la tool "ask_clarifying_question" que te da opciones cliqueables para el usuario.
- Pasale 3-5 opciones cortas (máximo 4 palabras cada una), concretas y mutuamente excluyentes.
- La última opción SIEMPRE puede ser "otro — escribir" para que el usuario pueda escribir libre si ninguna le encaja.
- Hacé UNA pregunta por turno.
- Preguntas en español rioplatense, tono amable y directo.

Cuándo NO preguntar:
- Si el usuario ya dio info suficiente (tipo de comercio + zona) en su mensaje, NO preguntes de más: llamá a "search_places" directamente.
- No inventes datos del producto del usuario.
- Nunca menciones que sos una IA ni expliques tu proceso interno.`

func runIntake(messages []Message) (*intakeResponse, error) {
	apiKey := os.Getenv("ANTHROPIC_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("ANTHROPIC_API_KEY no configurada")
	}

	searchTool := intakeTool{
		Name:        "search_places",
		Description: "Busca negocios reales en Google Maps según tipo de comercio y zona geográfica. Usar cuando tengas claro QUÉ busca el usuario y DÓNDE.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"business_type": map[string]interface{}{
					"type":        "string",
					"description": "Tipo de comercio en español, ej: 'cafeterías', 'gimnasios boutique', 'restaurantes vegetarianos'.",
				},
				"location": map[string]interface{}{
					"type":        "string",
					"description": "Zona geográfica, ej: 'Palermo, Buenos Aires', 'Recoleta, CABA', 'centro de Córdoba'.",
				},
				"min_rating": map[string]interface{}{
					"type":        "number",
					"description": "Rating mínimo (0-5). Opcional.",
				},
				"min_reviews": map[string]interface{}{
					"type":        "integer",
					"description": "Cantidad mínima de reviews. Opcional.",
				},
			},
			"required": []string{"business_type", "location"},
		},
	}

	askTool := intakeTool{
		Name:        "ask_clarifying_question",
		Description: "Hacer UNA pregunta al usuario con 3-5 opciones cliqueables. SIEMPRE usá esta tool para preguntar — nunca escribas preguntas como texto libre.",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"question": map[string]interface{}{
					"type":        "string",
					"description": "La pregunta, corta y concreta. Máximo 1 oración.",
				},
				"options": map[string]interface{}{
					"type":        "array",
					"description": "3 a 5 opciones cortas (máximo 4 palabras cada una). La última opción debería ser 'otro — escribir' para permitir texto libre.",
					"items":       map[string]interface{}{"type": "string"},
					"minItems":    3,
					"maxItems":    5,
				},
			},
			"required": []string{"question", "options"},
		},
	}

	reqBody := intakeRequest{
		Model:     "claude-sonnet-4-20250514",
		MaxTokens: 1024,
		System:    intakeSystemPrompt,
		Messages:  messages,
		Tools:     []intakeTool{searchTool, askTool},
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, _ := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("llamando Claude: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Claude API %d: %s", resp.StatusCode, string(respBody))
	}

	var ir intakeResponse
	if err := json.Unmarshal(respBody, &ir); err != nil {
		return nil, err
	}
	return &ir, nil
}

// Intake runs one turn of the intake conversation and returns either a reply
// (more questions needed) or the extracted search parameters (ready to search).
func Intake(messages []Message) (*IntakeResult, error) {
	resp, err := runIntake(messages)
	if err != nil {
		return nil, err
	}

	result := &IntakeResult{}
	for _, block := range resp.Content {
		switch block.Type {
		case "text":
			if result.Reply == "" {
				result.Reply = block.Text
			}
		case "tool_use":
			switch block.Name {
			case "search_places":
				result.SearchParams = block.Input
				result.Done = true
			case "ask_clarifying_question":
				if q, ok := block.Input["question"].(string); ok {
					result.Reply = q
				}
				if opts, ok := block.Input["options"].([]interface{}); ok {
					for _, o := range opts {
						if s, ok := o.(string); ok {
							result.Options = append(result.Options, s)
						}
					}
				}
			}
		}
	}
	return result, nil
}
