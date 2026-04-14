package scoring

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/Rose-ing/zero/internal/places"
)

const (
	haikuModel  = "claude-haiku-4-5-20251001"
	llmParallel = 6
	llmTimeout  = 12 * time.Second
)

type llmRequest struct {
	Model     string                   `json:"model"`
	MaxTokens int                      `json:"max_tokens"`
	System    string                   `json:"system"`
	Messages  []map[string]interface{} `json:"messages"`
}

type llmContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type llmResponse struct {
	Content []llmContent `json:"content"`
	Error   *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type llmVerdict struct {
	Score              int    `json:"score"`
	Reason             string `json:"reason"`
	MonthlyVisitorsEst int    `json:"monthly_visitors_est"`
	EstimatedTicketARS int    `json:"estimated_ticket_ars"`
}

// ScoreWithLLM enriches the top N leads with a Haiku-based likelihood score.
// productContext describes what the user is selling (their value prop).
func ScoreWithLLM(leads []places.Lead, topN int, productContext string) []places.Lead {
	apiKey := os.Getenv("ANTHROPIC_API_KEY")
	if apiKey == "" {
		return leads
	}
	client := &http.Client{Timeout: llmTimeout}
	sem := make(chan struct{}, llmParallel)
	var wg sync.WaitGroup

	for i := range leads {
		if i >= topN {
			break
		}
		if leads[i].Breakdown != nil && leads[i].Breakdown.IsChain {
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(idx int) {
			defer wg.Done()
			defer func() { <-sem }()
			v, err := askHaiku(client, apiKey, &leads[idx], productContext)
			if err != nil || v == nil {
				return
			}
			// Map 0–10 → 0–100 for likelihood
			scaled := v.Score * 10
			if scaled > 100 {
				scaled = 100
			}
			if leads[idx].Breakdown != nil {
				leads[idx].Breakdown.Likelihood = scaled
				leads[idx].Breakdown.LLMReason = v.Reason
				leads[idx].Score = recompute(leads[idx].Breakdown)
			}
			if v.MonthlyVisitorsEst > 0 {
				leads[idx].MonthlyVisitorsEst = v.MonthlyVisitorsEst
			}
			if v.EstimatedTicketARS > 0 {
				leads[idx].EstimatedTicketARS = v.EstimatedTicketARS
			}
		}(i)
	}
	wg.Wait()
	return leads
}

func askHaiku(client *http.Client, apiKey string, lead *places.Lead, product string) (*llmVerdict, error) {
	var enrichStr string
	if lead.Enrichment != nil {
		e := lead.Enrichment
		enrichStr = fmt.Sprintf(
			"\nweb_title: %s\nweb_desc: %s\nig: @%s (%d followers)\nig_bio: %s",
			truncate(e.WebsiteTitle, 120),
			truncate(e.WebsiteSample, 200),
			e.Instagram,
			e.IGFollowers,
			truncate(e.IGBio, 200),
		)
	}

	userMsg := fmt.Sprintf(`Evaluá este comercio como posible cliente B2B y estimá métricas clave.

PRODUCTO A VENDERLE:
%s

COMERCIO:
nombre: %s
tipo: %s
rating: %.1f (%d reviews)
dirección: %s
website: %s%s

Respondé SOLO con un JSON válido en una línea, sin markdown:
{"score": <0-10>, "reason": "<máx 15 palabras>", "monthly_visitors_est": <entero>, "estimated_ticket_ars": <entero en ARS>}

Criterios:
- score: 0-2 no contactar · 3-5 posible · 6-8 buen match · 9-10 match ideal
- monthly_visitors_est: aproximar visitantes mensuales del local usando reviews como proxy (regla: reviews × 40-80 según tamaño y tipo)
- estimated_ticket_ars: ticket de VENTA del producto al comercio en ARS por mes (no el ticket del cliente final). Considerar tamaño del local y el producto ofrecido.`,
		product,
		lead.Name, lead.PrimaryType, lead.Rating, lead.Reviews, lead.Address, lead.Website,
		enrichStr,
	)

	body, _ := json.Marshal(llmRequest{
		Model:     haikuModel,
		MaxTokens: 120,
		System:    "Sos un analista de ventas B2B. Respondés solo JSON, sin texto extra.",
		Messages: []map[string]interface{}{
			{"role": "user", "content": userMsg},
		},
	})

	req, _ := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("haiku %d: %s", resp.StatusCode, string(respBody))
	}
	var lr llmResponse
	if err := json.Unmarshal(respBody, &lr); err != nil {
		return nil, err
	}
	if len(lr.Content) == 0 {
		return nil, fmt.Errorf("empty haiku response")
	}
	text := lr.Content[0].Text
	// Strip potential code fences
	text = stripFences(text)
	var v llmVerdict
	if err := json.Unmarshal([]byte(text), &v); err != nil {
		return nil, fmt.Errorf("parsing verdict: %w (got: %s)", err, text)
	}
	return &v, nil
}

func stripFences(s string) string {
	s = strings.ReplaceAll(s, "```json", "")
	s = strings.ReplaceAll(s, "```", "")
	return strings.TrimSpace(s)
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

func recompute(b *places.Breakdown) int {
	total := (b.Fit*35 + b.Contact*25 + b.Health*25 + b.Likelihood*15) / 100
	if total > 100 {
		return 100
	}
	if total < 0 {
		return 0
	}
	return total
}
