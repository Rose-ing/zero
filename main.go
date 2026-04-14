package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/Rose-ing/zero/internal/agent"
	"github.com/Rose-ing/zero/internal/enrich"
	"github.com/Rose-ing/zero/internal/places"
	"github.com/Rose-ing/zero/internal/scoring"
)

type chatRequest struct {
	Messages []agent.Message `json:"messages"`
}

type chatResponse struct {
	Reply string `json:"reply"`
}

type errorResponse struct {
	Error string `json:"error"`
}

type intakeResponse struct {
	Reply        string                 `json:"reply,omitempty"`
	SearchParams map[string]interface{} `json:"search_params,omitempty"`
	Done         bool                   `json:"done"`
}

type searchRequest struct {
	BusinessType   string  `json:"business_type"`
	Location       string  `json:"location"`
	MinRating      float64 `json:"min_rating,omitempty"`
	MinReviews     int     `json:"min_reviews,omitempty"`
	ProductContext string  `json:"product_context,omitempty"`
}

type searchResponse struct {
	Params places.SearchParams `json:"params"`
	Leads  []places.Lead       `json:"leads"`
	Count  int                 `json:"count"`
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	mux := http.NewServeMux()

	// Static frontend (client-facing flow at /, backoffice prototype at /backoffice)
	mux.Handle("/", http.FileServer(http.Dir("web")))

	mux.HandleFunc("POST /api/chat", handleChat)
	mux.HandleFunc("POST /api/intake", handleIntake)
	mux.HandleFunc("POST /api/search", handleSearch)

	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	log.Printf("Server listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func handleChat(w http.ResponseWriter, r *http.Request) {
	var req chatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, errorResponse{Error: "request inválido"})
		return
	}
	if len(req.Messages) == 0 {
		writeJSON(w, 400, errorResponse{Error: "no hay mensajes"})
		return
	}
	reply, err := agent.Chat(req.Messages)
	if err != nil {
		log.Printf("agent.Chat: %v", err)
		writeJSON(w, 500, errorResponse{Error: "error procesando la consulta"})
		return
	}
	writeJSON(w, 200, chatResponse{Reply: reply})
}

func handleIntake(w http.ResponseWriter, r *http.Request) {
	var req chatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, errorResponse{Error: "request inválido"})
		return
	}
	if len(req.Messages) == 0 {
		writeJSON(w, 400, errorResponse{Error: "no hay mensajes"})
		return
	}
	result, err := agent.Intake(req.Messages)
	if err != nil {
		log.Printf("agent.Intake: %v", err)
		writeJSON(w, 500, errorResponse{Error: "error en el intake"})
		return
	}
	writeJSON(w, 200, intakeResponse{
		Reply:        result.Reply,
		SearchParams: result.SearchParams,
		Done:         result.Done,
	})
}

func handleSearch(w http.ResponseWriter, r *http.Request) {
	var req searchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, errorResponse{Error: "request inválido"})
		return
	}
	if req.BusinessType == "" || req.Location == "" {
		writeJSON(w, 400, errorResponse{Error: "business_type y location son obligatorios"})
		return
	}
	params := places.SearchParams{
		BusinessType: req.BusinessType,
		Location:     req.Location,
		MinRating:    req.MinRating,
		MinReviews:   req.MinReviews,
	}
	leads, err := places.Search(params)
	if err != nil {
		log.Printf("places.Search: %v", err)
		writeJSON(w, 500, errorResponse{Error: "error buscando en Google Maps"})
		return
	}

	// 1. Score básico + chain detection
	leads = scoring.ScoreAll(leads)

	// 2. Sort inicial por score para que enrichment + LLM vayan a los mejores
	sortByScore(leads)

	// 3. Enrichment (web + IG) para los top 30 no-cadenas
	leads = enrich.EnrichAll(leads, 30)

	// 4. LLM scoring con Haiku para los top 30 no-cadenas
	product := req.ProductContext
	if product == "" {
		product = "producto/servicio B2B genérico"
	}
	leads = scoring.ScoreWithLLM(leads, 30, product)

	// 5. Finalize: id, category, followers, best_channel, contact_value, ticket
	leads = scoring.Finalize(leads)

	// 6. Re-sort final con scores actualizados
	sortByScore(leads)

	writeJSON(w, 200, searchResponse{Params: params, Leads: leads, Count: len(leads)})
}

func sortByScore(leads []places.Lead) {
	for i := 0; i < len(leads); i++ {
		for j := i + 1; j < len(leads); j++ {
			if leads[j].Score > leads[i].Score {
				leads[i], leads[j] = leads[j], leads[i]
			}
		}
	}
}
