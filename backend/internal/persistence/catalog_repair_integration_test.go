package persistence

import "testing"

func TestCanonicalBranchCatalogRepairMigration(t *testing.T) {
	ctx, p, m := integration(t)

	if err := m.Steps(-1); err != nil {
		t.Fatal(err)
	}
	const branchID = "9e364b61-0543-5502-b048-50b2e65879a3"
	if _, err := p.pool.Exec(ctx, `UPDATE branches SET name='Потерянное отделение', address='старый адрес', latitude=0, longitude=0 WHERE id=$1`, branchID); err != nil {
		t.Fatal(err)
	}
	if err := m.Steps(1); err != nil {
		t.Fatal(err)
	}

	var name, address string
	var latitude, longitude float64
	if err := p.pool.QueryRow(ctx, `SELECT name,address,latitude,longitude FROM branches WHERE id=$1`, branchID).Scan(&name, &address, &latitude, &longitude); err != nil {
		t.Fatal(err)
	}
	if name != "Главпочтамт Мясницкая" || address != "г. Москва, ул. Мясницкая, д. 26А, стр. 1" {
		t.Fatalf("catalog was not repaired: name=%q address=%q", name, address)
	}
	if latitude != 55.764239 || longitude != 37.637392 {
		t.Fatalf("catalog coordinates were not repaired: %f,%f", latitude, longitude)
	}
}
