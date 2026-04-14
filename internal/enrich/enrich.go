package enrich

import (
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Rose-ing/zero/internal/places"
)

var (
	emailRE   = regexp.MustCompile(`(?i)[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}`)
	whatsRE   = regexp.MustCompile(`(?i)(?:wa\.me/|api\.whatsapp\.com/send\?phone=|whatsapp[:\s]*)(\+?\d[\d\s\-]{6,})`)
	igHandleRE = regexp.MustCompile(`(?i)(?:instagram\.com/|ig:\s*@)([a-zA-Z0-9._]{2,30})`)
	// Handles inválidos que suelen capturarse por accidente
	invalidIGHandles = map[string]bool{
		"rsrc":     true,
		"rsrc.php": true,
		"embed":    true,
		"p":        true,
		"reel":     true,
		"explore":  true,
		"accounts": true,
		"static":   true,
		"stories":  true,
		"tv":       true,
		"direct":   true,
	}
	titleRE   = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	ogDescRE  = regexp.MustCompile(`(?i)<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']`)
	descRE    = regexp.MustCompile(`(?i)<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']`)
	// Followers from IG profile page (very brittle, but works for public profiles)
	igFollowersRE = regexp.MustCompile(`"edge_followed_by":\{"count":(\d+)\}`)
	igBioRE       = regexp.MustCompile(`"biography":"([^"]*)"`)
)

const (
	httpTimeout  = 8 * time.Second
	maxBody      = 300 * 1024 // 300 KB
	maxParallel  = 8
	userAgent    = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

// EnrichAll runs website + IG enrichment on the top N leads in parallel.
// Leads without a score of >= minScore or flagged as chain are skipped.
func EnrichAll(leads []places.Lead, topN int) []places.Lead {
	client := &http.Client{Timeout: httpTimeout}
	sem := make(chan struct{}, maxParallel)
	var wg sync.WaitGroup

	for i := range leads {
		if i >= topN {
			break
		}
		if leads[i].Breakdown != nil && leads[i].Breakdown.IsChain {
			continue // no vale la pena enriquecer cadenas
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(idx int) {
			defer wg.Done()
			defer func() { <-sem }()
			enrichOne(client, &leads[idx])
		}(i)
	}
	wg.Wait()
	return leads
}

func enrichOne(client *http.Client, lead *places.Lead) {
	e := &places.Enrichment{}

	// 1. Fetch website (if any)
	if lead.Website != "" {
		html, err := fetchText(client, lead.Website)
		if err == nil {
			if m := titleRE.FindStringSubmatch(html); len(m) > 1 {
				e.WebsiteTitle = strings.TrimSpace(stripTags(m[1]))
			}
			if m := ogDescRE.FindStringSubmatch(html); len(m) > 1 {
				e.WebsiteSample = strings.TrimSpace(m[1])
			} else if m := descRE.FindStringSubmatch(html); len(m) > 1 {
				e.WebsiteSample = strings.TrimSpace(m[1])
			}
			if m := emailRE.FindString(html); m != "" && !isNoisyEmail(m) {
				e.Email = m
			}
			if m := whatsRE.FindStringSubmatch(html); len(m) > 1 {
				e.WhatsApp = cleanPhone(m[1])
			}
			if m := igHandleRE.FindStringSubmatch(html); len(m) > 1 {
				handle := strings.TrimSuffix(m[1], "/")
				handle = strings.TrimSuffix(handle, ".php")
				if !invalidIGHandles[strings.ToLower(handle)] && !strings.Contains(handle, ".") {
					e.Instagram = handle
				}
			}
		}
	}

	// 2. Scrape Instagram profile (if we found a handle or can guess one)
	if e.Instagram != "" {
		igURL := "https://www.instagram.com/" + e.Instagram + "/"
		html, err := fetchText(client, igURL)
		if err == nil {
			if m := igFollowersRE.FindStringSubmatch(html); len(m) > 1 {
				n, _ := strconv.Atoi(m[1])
				e.IGFollowers = n
			}
			if m := igBioRE.FindStringSubmatch(html); len(m) > 1 {
				e.IGBio = unescape(m[1])
			}
		}
	}

	// Attach only if we got anything
	if e.Email != "" || e.Instagram != "" || e.WebsiteTitle != "" || e.WhatsApp != "" {
		lead.Enrichment = e
		// Bump contact score if we pulled a direct contact channel
		if lead.Breakdown != nil {
			bonus := 0
			if e.Email != "" {
				bonus += 10
			}
			if e.WhatsApp != "" {
				bonus += 10
			}
			if e.Instagram != "" {
				bonus += 5
			}
			lead.Breakdown.Contact = clamp(lead.Breakdown.Contact+bonus, 0, 100)
			lead.Score = recomputeTotal(lead.Breakdown)
		}
	}
}

func fetchText(client *http.Client, url string) (string, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept-Language", "es-AR,es;q=0.9,en;q=0.8")
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	limited := io.LimitReader(resp.Body, maxBody)
	b, err := io.ReadAll(limited)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func stripTags(s string) string {
	return regexp.MustCompile(`<[^>]+>`).ReplaceAllString(s, "")
}

func cleanPhone(s string) string {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, " ", "")
	s = strings.ReplaceAll(s, "-", "")
	return s
}

func isNoisyEmail(s string) bool {
	bad := []string{"example.com", "sentry.io", "wixpress.com", "sentry-next", "wix.com", "@2x.png"}
	for _, b := range bad {
		if strings.Contains(s, b) {
			return true
		}
	}
	return false
}

func unescape(s string) string {
	s = strings.ReplaceAll(s, `\n`, " ")
	s = strings.ReplaceAll(s, `\"`, `"`)
	s = strings.ReplaceAll(s, `\/`, "/")
	return s
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

func recomputeTotal(b *places.Breakdown) int {
	total := (b.Fit*35 + b.Contact*25 + b.Health*25 + b.Likelihood*15) / 100
	return clamp(total, 0, 100)
}
