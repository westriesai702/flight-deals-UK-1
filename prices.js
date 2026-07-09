// /api/prices.js — Vercel serverless function
// Fetches real cached fares from the Travelpayouts Data API (Aviasales).
// The API token is read from an environment variable so it's never exposed
// to the browser or committed to GitHub.
//
// Query params: ?origin=LGW&destination=NCE
// Returns: { success: true, data: [{ depart, ret, price, transfers }, ...] }

module.exports = async (req, res) => {
  const { origin, destination } = req.query;

  if (!origin || !destination) {
    res.status(400).json({ success: false, error: 'origin and destination query params are required' });
    return;
  }

  const token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token) {
    res.status(500).json({ success: false, error: 'Server is missing TRAVELPAYOUTS_TOKEN environment variable' });
    return;
  }

  // Look across the current month + next 5 months
  const months = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  try {
    const collected = [];

    for (const m of months) {
      const url = `https://api.travelpayouts.com/v1/prices/cheap?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&depart_date=${m}&return_date=${m}&currency=gbp&token=${token}`;
      const r = await fetch(url);
      if (!r.ok) continue;
      const json = await r.json();
      if (json.success && json.data && json.data[destination]) {
        Object.values(json.data[destination]).forEach(entry => {
          if (entry.departure_at && entry.return_at && entry.price) {
            collected.push({
              depart: entry.departure_at.slice(0, 10),
              ret: entry.return_at.slice(0, 10),
              price: Math.round(entry.price),
              transfers: entry.number_of_changes ?? null
            });
          }
        });
      }
    }

    // De-duplicate by departure date, keeping the cheapest entry found
    const byDate = {};
    collected.forEach(e => {
      if (!byDate[e.depart] || byDate[e.depart].price > e.price) byDate[e.depart] = e;
    });
    const list = Object.values(byDate).sort((a, b) => a.depart.localeCompare(b.depart));

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
};
