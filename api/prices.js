// /api/prices.js — Vercel serverless function
// Fetches real cached one-way fares (per day) from the Travelpayouts Data API
// (Aviasales month-matrix endpoint), which is far denser than the
// single-cheapest-per-month endpoint. The API token is read from an
// environment variable so it's never exposed to the browser or committed
// to GitHub.
//
// Query params: ?origin=LGW&destination=NCE
// Returns: { success: true, data: [{ depart, price }, ...] }

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
    const byDate = {};

    for (const m of months) {
      const url = `https://api.travelpayouts.com/v2/prices/month-matrix?currency=gbp&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&show_to_affiliates=true&month=${m}-01&token=${token}`;
      const r = await fetch(url);
      if (!r.ok) continue;
      const json = await r.json();
      if (json.success && Array.isArray(json.data)) {
        json.data.forEach(entry => {
          const depart = entry.depart_date || entry.date;
          const price = entry.price || entry.value;
          if (!depart || !price) return;
          if (!byDate[depart] || byDate[depart] > price) byDate[depart] = price;
        });
      }
    }

    const list = Object.keys(byDate)
      .sort()
      .map(depart => ({ depart, price: Math.round(byDate[depart]) }));

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
};
