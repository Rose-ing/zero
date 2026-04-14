package places

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
)

type Lead struct {
	PlaceID     string     `json:"place_id"`
	Name        string     `json:"name"`
	Address     string     `json:"address"`
	Phone       string     `json:"phone"`
	Website     string     `json:"website"`
	MapsURL     string     `json:"maps_url"`
	Rating      float64    `json:"rating"`
	Reviews     int        `json:"reviews"`
	PriceLevel  string     `json:"price_level"`
	PrimaryType string     `json:"primary_type"`
	Lat         float64    `json:"lat"`
	Lng         float64    `json:"lng"`
	Score       int        `json:"score,omitempty"`
	Breakdown   *Breakdown `json:"breakdown,omitempty"`
	Enrichment  *Enrichment `json:"enrichment,omitempty"`

	// Campos finales consumibles por outreach
	ID                  string  `json:"id"`
	Category            string  `json:"category"`
	MonthlyVisitorsEst  int     `json:"monthly_visitors_est"`
	BestChannel         string  `json:"best_channel"`          // email | whatsapp | phone
	ContactValue        string  `json:"contact_value"`         // el valor concreto del canal elegido
	EstimatedTicketARS  int     `json:"estimated_ticket_ars"`  // ticket estimado en ARS
	CostPerContactUSD   float64 `json:"cost_per_contact_usd"`  // costo de contactar este lead por su mejor canal
	ReachScore          int     `json:"reach_score"`           // reviews + visitantes/10 — proxy de alcance/impacto
	ROIEstimate         float64 `json:"roi_estimate"`          // ticket_usd / cost_per_contact
}

type Breakdown struct {
	Fit         int      `json:"fit"`
	Contact     int      `json:"contact"`
	Health      int      `json:"health"`
	Likelihood  int      `json:"likelihood"`
	Flags       []string `json:"flags"`
	IsChain     bool     `json:"is_chain"`
	ChainReason string   `json:"chain_reason,omitempty"`
	LLMReason   string   `json:"llm_reason,omitempty"`
}

type Enrichment struct {
	Email         string `json:"email,omitempty"`
	WhatsApp      string `json:"whatsapp,omitempty"`
	WebsiteTitle  string `json:"website_title,omitempty"`
	WebsiteSample string `json:"website_sample,omitempty"`
}

type SearchParams struct {
	BusinessType string  `json:"business_type"`
	Location     string  `json:"location"`
	MinRating    float64 `json:"min_rating,omitempty"`
	MinReviews   int     `json:"min_reviews,omitempty"`
}

type textSearchRequest struct {
	TextQuery    string `json:"textQuery"`
	LanguageCode string `json:"languageCode"`
	RegionCode   string `json:"regionCode"`
	PageSize     int    `json:"pageSize"`
	PageToken    string `json:"pageToken,omitempty"`
}

type placeResponse struct {
	ID               string `json:"id"`
	DisplayName      struct {
		Text string `json:"text"`
	} `json:"displayName"`
	FormattedAddress      string  `json:"formattedAddress"`
	NationalPhoneNumber   string  `json:"nationalPhoneNumber"`
	WebsiteURI            string  `json:"websiteUri"`
	GoogleMapsURI         string  `json:"googleMapsUri"`
	Rating                float64 `json:"rating"`
	UserRatingCount       int     `json:"userRatingCount"`
	PriceLevel            string  `json:"priceLevel"`
	PrimaryType           string  `json:"primaryType"`
	Location              struct {
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
	} `json:"location"`
}

type searchResponse struct {
	Places        []placeResponse `json:"places"`
	NextPageToken string          `json:"nextPageToken"`
}

const fieldMask = "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.rating,places.userRatingCount,places.priceLevel,places.primaryType,places.location,nextPageToken"

func Search(params SearchParams) ([]Lead, error) {
	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("GOOGLE_PLACES_API_KEY no configurada")
	}

	query := fmt.Sprintf("%s en %s", params.BusinessType, params.Location)
	seen := map[string]Lead{}

	// Text Search, up to 3 pages (60 results max)
	var pageToken string
	for page := 0; page < 3; page++ {
		resp, err := doTextSearch(apiKey, query, pageToken)
		if err != nil {
			return nil, err
		}
		for _, p := range resp.Places {
			if _, exists := seen[p.ID]; exists {
				continue
			}
			if params.MinRating > 0 && p.Rating < params.MinRating {
				continue
			}
			if params.MinReviews > 0 && p.UserRatingCount < params.MinReviews {
				continue
			}
			seen[p.ID] = toLead(p)
		}
		if resp.NextPageToken == "" {
			break
		}
		pageToken = resp.NextPageToken
	}

	leads := make([]Lead, 0, len(seen))
	for _, l := range seen {
		leads = append(leads, l)
	}
	sort.Slice(leads, func(i, j int) bool {
		return leads[i].Reviews > leads[j].Reviews
	})
	return leads, nil
}

func doTextSearch(apiKey, query, pageToken string) (*searchResponse, error) {
	body, _ := json.Marshal(textSearchRequest{
		TextQuery:    query,
		LanguageCode: "es",
		RegionCode:   "AR",
		PageSize:     20,
		PageToken:    pageToken,
	})

	req, err := http.NewRequest("POST", "https://places.googleapis.com/v1/places:searchText", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", apiKey)
	req.Header.Set("X-Goog-FieldMask", fieldMask)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("llamando Places API: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Places API %d: %s", resp.StatusCode, string(respBody))
	}

	var sr searchResponse
	if err := json.Unmarshal(respBody, &sr); err != nil {
		return nil, fmt.Errorf("parseando Places: %w", err)
	}
	return &sr, nil
}

func toLead(p placeResponse) Lead {
	return Lead{
		PlaceID:     p.ID,
		Name:        p.DisplayName.Text,
		Address:     p.FormattedAddress,
		Phone:       p.NationalPhoneNumber,
		Website:     p.WebsiteURI,
		MapsURL:     p.GoogleMapsURI,
		Rating:      p.Rating,
		Reviews:     p.UserRatingCount,
		PriceLevel:  p.PriceLevel,
		PrimaryType: p.PrimaryType,
		Lat:         p.Location.Latitude,
		Lng:         p.Location.Longitude,
	}
}
