package scoring

import (
	"strings"

	"github.com/Rose-ing/zero/internal/places"
)

// ScoreBreakdown gives per-dimension scores (0-100) and flags.
type ScoreBreakdown struct {
	Fit         int      `json:"fit"`
	Contact     int      `json:"contact"`
	Health      int      `json:"health"`
	Likelihood  int      `json:"likelihood"`
	Total       int      `json:"total"`
	Flags       []string `json:"flags"`
	IsChain     bool     `json:"is_chain"`
	ChainReason string   `json:"chain_reason,omitempty"`
}

// knownChains are big chains we almost never want to contact — procurement is centralized.
var knownChains = map[string]bool{
	"starbucks":          true,
	"havanna":            true,
	"le pain quotidien":  true,
	"mcdonald":           true,
	"mcdonalds":          true,
	"mccafé":             true,
	"mccafe":             true,
	"burger king":        true,
	"subway":             true,
	"bonafide":           true,
	"martínez":           true,
	"the coffee store":   true,
	"dunkin":             true,
	"tea connection":     true,
	"café martinez":      true,
	"cafe martinez":      true,
	"la fonte d'oro":     true,
	"la fonte doro":      true,
	"mostaza":            true,
	"kfc":                true,
	"freddo":             true,
	"grido":              true,
	"chungo":             true,
}

// specialtyHints boost the fit score (artisanal / specialty signals).
var specialtyHints = []string{
	"especialidad", "specialty", "artesanal", "de autor",
	"coffee", "café de", "boutique", "tostador", "roaster",
	"barista",
}

// negativeHints penalize fit (gas stations, kioscos, fast food, etc.)
var negativeHints = []string{
	"ypf", "axion", "shell", "puma energy", "estacion de servicio",
	"kiosco", "maxikiosco", "autoservicio", "playa de estac",
}

// ScoreAll ranks leads and tags chains. It also detects same-name repetition
// within the result set (if a brand appears ≥3 times → treat as chain).
func ScoreAll(leads []places.Lead) []places.Lead {
	// Count repeated brand names (normalized) in the result set.
	counts := map[string]int{}
	for _, l := range leads {
		counts[normalizeBrand(l.Name)]++
	}

	for i := range leads {
		b := buildBreakdown(leads[i], counts)
		leads[i].Score = b.Total
		leads[i].Breakdown = &places.Breakdown{
			Fit:         b.Fit,
			Contact:     b.Contact,
			Health:      b.Health,
			Likelihood:  b.Likelihood,
			Flags:       b.Flags,
			IsChain:     b.IsChain,
			ChainReason: b.ChainReason,
		}
	}
	return leads
}

func buildBreakdown(l places.Lead, counts map[string]int) ScoreBreakdown {
	b := ScoreBreakdown{Flags: []string{}}

	// --- Chain detection ---
	nameLower := strings.ToLower(l.Name)
	brand := normalizeBrand(l.Name)
	if isKnownChain(nameLower) {
		b.IsChain = true
		b.ChainReason = "cadena conocida"
	} else if counts[brand] >= 3 {
		b.IsChain = true
		b.ChainReason = "aparece múltiples veces (cadena chica)"
	}

	// --- Fit (0-100) ---
	fit := 50
	primary := strings.ToLower(l.PrimaryType)
	if strings.Contains(primary, "cafe") || strings.Contains(primary, "coffee") {
		fit += 25
	} else if strings.Contains(primary, "bakery") || strings.Contains(primary, "brunch") {
		fit += 10
	} else if strings.Contains(primary, "restaurant") {
		fit += 5
	}
	// Specialty hints
	for _, h := range specialtyHints {
		if strings.Contains(nameLower, h) {
			fit += 8
			break
		}
	}
	// Negative hints (gas station with cafe, kioscos)
	for _, h := range negativeHints {
		if strings.Contains(nameLower, h) {
			fit -= 40
			b.Flags = append(b.Flags, "posible estación de servicio / kiosco")
			break
		}
	}
	// Price level: $$ or $$$ is sweet spot
	switch l.PriceLevel {
	case "PRICE_LEVEL_MODERATE", "PRICE_LEVEL_EXPENSIVE":
		fit += 5
	case "PRICE_LEVEL_INEXPENSIVE":
		fit -= 5
	}
	b.Fit = clamp(fit, 0, 100)

	// --- Contact (0-100) ---
	contact := 0
	if l.Phone != "" {
		contact += 50
	}
	if l.Website != "" {
		contact += 30
	}
	if l.Address != "" {
		contact += 20
	}
	b.Contact = clamp(contact, 0, 100)
	if l.Phone == "" {
		b.Flags = append(b.Flags, "sin teléfono")
	}

	// --- Health (0-100) ---
	health := 0
	// Rating sweet spot 4.2–4.8
	if l.Rating >= 4.2 && l.Rating <= 4.8 {
		health += 50
	} else if l.Rating >= 4.0 && l.Rating < 4.2 {
		health += 35
	} else if l.Rating > 4.8 {
		health += 40 // puede ser sospechoso si hay pocos reviews
	} else if l.Rating >= 3.8 {
		health += 20
	} else if l.Rating > 0 {
		health += 5
		b.Flags = append(b.Flags, "rating bajo")
	}
	// Reviews volume (proxy de tráfico real)
	switch {
	case l.Reviews >= 500 && l.Reviews <= 5000:
		health += 50
	case l.Reviews >= 200 && l.Reviews < 500:
		health += 40
	case l.Reviews > 5000:
		health += 30 // demasiado grande, suele ser cadena
	case l.Reviews >= 80:
		health += 25
	case l.Reviews >= 30:
		health += 10
	default:
		health += 0
		if l.Reviews < 30 {
			b.Flags = append(b.Flags, "muy pocas reviews")
		}
	}
	b.Health = clamp(health, 0, 100)

	// --- Likelihood (0-100) — heurístico, se refina con LLM después ---
	like := 50
	if b.IsChain {
		like = 5
		b.Flags = append(b.Flags, "cadena — compra centralizada")
	} else {
		// Tamaño sweet spot: 100–3000 reviews (ni muy chico ni muy grande)
		if l.Reviews >= 100 && l.Reviews <= 3000 {
			like += 25
		} else if l.Reviews > 3000 {
			like -= 10
		} else if l.Reviews < 50 {
			like -= 15
		}
		// Especialidad boost
		for _, h := range specialtyHints {
			if strings.Contains(nameLower, h) {
				like += 10
				break
			}
		}
	}
	b.Likelihood = clamp(like, 0, 100)

	// --- Total weighted ---
	b.Total = clamp(
		(b.Fit*35+b.Contact*25+b.Health*25+b.Likelihood*15)/100,
		0, 100,
	)
	return b
}

func normalizeBrand(name string) string {
	n := strings.ToLower(name)
	// Remove common location suffixes ("- Palermo", "Palermo", "Soho", "Hollywood")
	cuts := []string{"palermo", "soho", "hollywood", "cañitas", "recoleta", "soler", "matienzo", "armenia"}
	for _, c := range cuts {
		n = strings.ReplaceAll(n, c, "")
	}
	n = strings.ReplaceAll(n, "-", "")
	n = strings.ReplaceAll(n, "|", "")
	n = strings.Join(strings.Fields(n), " ")
	// Only keep first 2 significant words as the "brand"
	parts := strings.Fields(n)
	if len(parts) > 2 {
		parts = parts[:2]
	}
	return strings.Join(parts, " ")
}

func isKnownChain(nameLower string) bool {
	for chain := range knownChains {
		if strings.Contains(nameLower, chain) {
			return true
		}
	}
	return false
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
