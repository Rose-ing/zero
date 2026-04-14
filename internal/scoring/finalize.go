package scoring

import (
	"strings"

	"github.com/Rose-ing/zero/internal/places"
)

// Finalize fills the user-facing fields: id, category, followers,
// best_channel, contact_value, and falls back for monthly_visitors_est
// / estimated_ticket_ars when the LLM didn't set them (e.g. chains skipped).
func Finalize(leads []places.Lead) []places.Lead {
	for i := range leads {
		l := &leads[i]

		// id = place_id (consumible estable)
		l.ID = l.PlaceID

		// category: usar primary_type normalizado
		l.Category = prettifyCategory(l.PrimaryType)

		// followers desde enrichment
		if l.Enrichment != nil {
			l.Followers = l.Enrichment.IGFollowers
		}

		// Fallback de visitantes: reviews * 50 (ratio histórico ~2% de visitantes deja review)
		if l.MonthlyVisitorsEst == 0 && l.Reviews > 0 {
			l.MonthlyVisitorsEst = l.Reviews * 50
		}

		// Fallback de ticket: proporcional al tamaño del local
		if l.EstimatedTicketARS == 0 {
			l.EstimatedTicketARS = estimateTicket(l.Reviews, l.PriceLevel)
		}

		// Elegir mejor canal de contacto
		l.BestChannel, l.ContactValue = pickBestChannel(l)
	}
	return leads
}

// pickBestChannel: prioridad Email > WhatsApp > Phone > Instagram (DM).
// Email y WhatsApp permiten envío masivo personalizado con más tiempo para
// pitch, phone es sincrónico (mejor para cierre), IG es último recurso.
func pickBestChannel(l *places.Lead) (channel, value string) {
	e := l.Enrichment
	if e != nil {
		if e.Email != "" {
			return "email", e.Email
		}
		if e.WhatsApp != "" {
			return "whatsapp", e.WhatsApp
		}
	}
	if l.Phone != "" {
		return "phone", l.Phone
	}
	if e != nil && e.Instagram != "" {
		return "instagram", "@" + e.Instagram
	}
	return "none", ""
}

func prettifyCategory(t string) string {
	if t == "" {
		return "unknown"
	}
	t = strings.ToLower(t)
	t = strings.ReplaceAll(t, "_", " ")
	return t
}

// estimateTicket: fallback heurístico del ticket mensual en ARS que el comercio
// podría gastar en nuestro producto B2B. Calibrado para ARS abril 2026.
func estimateTicket(reviews int, priceLevel string) int {
	base := 0
	switch {
	case reviews >= 3000:
		base = 450_000
	case reviews >= 1000:
		base = 280_000
	case reviews >= 500:
		base = 180_000
	case reviews >= 200:
		base = 120_000
	case reviews >= 80:
		base = 70_000
	default:
		base = 40_000
	}
	// Ajuste por rango de precio
	switch priceLevel {
	case "PRICE_LEVEL_EXPENSIVE", "PRICE_LEVEL_VERY_EXPENSIVE":
		base = base * 130 / 100
	case "PRICE_LEVEL_INEXPENSIVE":
		base = base * 80 / 100
	}
	return base
}
