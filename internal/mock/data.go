package mock

// Product represents a mock product in the catalog.
type Product struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Category string  `json:"category"`
	Price    float64 `json:"price"`
	Stock    int     `json:"stock"`
	Status   string  `json:"status"`
}

// Order represents a mock order.
type Order struct {
	ID         string  `json:"id"`
	CustomerID string  `json:"customer_id"`
	Customer   string  `json:"customer"`
	Products   []string `json:"products"`
	Total      float64 `json:"total"`
	Status     string  `json:"status"`
	Date       string  `json:"date"`
}

// Customer represents a mock customer.
type Customer struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Email    string `json:"email"`
	Plan     string `json:"plan"`
	Since    string `json:"since"`
	Orders   int    `json:"orders"`
}

var Products = []Product{
	{ID: "P001", Name: "Notebook Pro 15", Category: "Electrónica", Price: 1299.99, Stock: 45, Status: "activo"},
	{ID: "P002", Name: "Mouse Inalámbrico MX", Category: "Electrónica", Price: 79.99, Stock: 120, Status: "activo"},
	{ID: "P003", Name: "Teclado Mecánico RGB", Category: "Electrónica", Price: 149.99, Stock: 0, Status: "sin stock"},
	{ID: "P004", Name: "Monitor 27\" 4K", Category: "Electrónica", Price: 549.99, Stock: 23, Status: "activo"},
	{ID: "P005", Name: "Auriculares BT Pro", Category: "Audio", Price: 199.99, Stock: 67, Status: "activo"},
	{ID: "P006", Name: "Webcam HD 1080p", Category: "Electrónica", Price: 89.99, Stock: 5, Status: "poco stock"},
	{ID: "P007", Name: "Silla Ergonómica", Category: "Muebles", Price: 399.99, Stock: 12, Status: "activo"},
	{ID: "P008", Name: "Escritorio Standing", Category: "Muebles", Price: 599.99, Stock: 8, Status: "activo"},
	{ID: "P009", Name: "Hub USB-C 7 en 1", Category: "Accesorios", Price: 59.99, Stock: 200, Status: "activo"},
	{ID: "P010", Name: "Mochila Laptop 17\"", Category: "Accesorios", Price: 89.99, Stock: 34, Status: "activo"},
}

var Orders = []Order{
	{ID: "ORD-001", CustomerID: "C001", Customer: "María García", Products: []string{"P001", "P009"}, Total: 1359.98, Status: "entregado", Date: "2026-04-10"},
	{ID: "ORD-002", CustomerID: "C002", Customer: "Juan Pérez", Products: []string{"P005"}, Total: 199.99, Status: "en camino", Date: "2026-04-12"},
	{ID: "ORD-003", CustomerID: "C003", Customer: "Ana López", Products: []string{"P007", "P008"}, Total: 999.98, Status: "procesando", Date: "2026-04-13"},
	{ID: "ORD-004", CustomerID: "C001", Customer: "María García", Products: []string{"P002", "P006"}, Total: 169.98, Status: "entregado", Date: "2026-04-08"},
	{ID: "ORD-005", CustomerID: "C004", Customer: "Carlos Ruiz", Products: []string{"P004", "P002", "P009"}, Total: 689.97, Status: "en camino", Date: "2026-04-13"},
	{ID: "ORD-006", CustomerID: "C005", Customer: "Laura Fernández", Products: []string{"P010"}, Total: 89.99, Status: "cancelado", Date: "2026-04-11"},
	{ID: "ORD-007", CustomerID: "C002", Customer: "Juan Pérez", Products: []string{"P001", "P005", "P010"}, Total: 1589.97, Status: "procesando", Date: "2026-04-14"},
}

var Customers = []Customer{
	{ID: "C001", Name: "María García", Email: "maria@email.com", Plan: "premium", Since: "2025-01-15", Orders: 12},
	{ID: "C002", Name: "Juan Pérez", Email: "juan@email.com", Plan: "básico", Since: "2025-06-20", Orders: 5},
	{ID: "C003", Name: "Ana López", Email: "ana@email.com", Plan: "premium", Since: "2024-11-03", Orders: 28},
	{ID: "C004", Name: "Carlos Ruiz", Email: "carlos@email.com", Plan: "básico", Since: "2026-02-10", Orders: 3},
	{ID: "C005", Name: "Laura Fernández", Email: "laura@email.com", Plan: "premium", Since: "2025-03-22", Orders: 15},
}
