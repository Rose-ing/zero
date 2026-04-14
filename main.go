package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/Rose-ing/zero/internal/agent"
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

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	mux := http.NewServeMux()

	// Serve static frontend
	mux.Handle("/", http.FileServer(http.Dir("web")))

	// Chat API endpoint
	mux.HandleFunc("POST /api/chat", handleChat)

	// Health check
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	log.Printf("Server listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}

func handleChat(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req chatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(errorResponse{Error: "request inválido"})
		return
	}

	if len(req.Messages) == 0 {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(errorResponse{Error: "no hay mensajes"})
		return
	}

	reply, err := agent.Chat(req.Messages)
	if err != nil {
		log.Printf("Error en agent.Chat: %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(errorResponse{Error: "error procesando la consulta"})
		return
	}

	json.NewEncoder(w).Encode(chatResponse{Reply: reply})
}
