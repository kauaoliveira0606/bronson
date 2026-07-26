// api/get-ads.js
// Fetch ad performance data for the dashboard

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gpthswrobafxtmsuouph.supabase.co';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { range = '7days', campaign, adSet, ad } = req.query;

    // Calculate date range
    let startDate = new Date();
    switch (range) {
      case '1day':
        startDate.setDate(startDate.getDate() - 1);
        break;
      case '7days':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30days':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90days':
        startDate.setDate(startDate.getDate() - 90);
        break;
      default:
        startDate.setDate(startDate.getDate() - 7);
    }

    const startDateStr = startDate.toISOString().split('T')[0];

    // Build query filters
    let filters = `date.gte.${startDateStr}`;
    if (campaign) filters += `&campaign_name.eq.${encodeURIComponent(campaign)}`;
    if (adSet) filters += `&ad_set_name.eq.${encodeURIComponent(adSet)}`;
    if (ad) filters += `&ad_name.eq.${encodeURIComponent(ad)}`;

    // Fetch ad performance data
    const adResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/ad_performance?${filters}&order=date.desc`,
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!adResponse.ok) {
      throw new Error(`Supabase error: ${adResponse.status}`);
    }

    const adData = await adResponse.json();

    // Calculate aggregated metrics
    const totalSpend = adData.reduce((sum, row) => sum + (row.spend || 0), 0);
    const totalLeads = adData.reduce((sum, row) => sum + (row.leads || 0), 0);
    const totalSales = adData.reduce((sum, row) => sum + (row.sales || 0), 0);
    const totalRevenue = adData.reduce((sum, row) => sum + (row.revenue || 0), 0);
    const avgCostPerLead = totalLeads > 0 ? totalSpend / totalLeads : 0;
    const avgCostPerSale = totalSales > 0 ? totalSpend / totalSales : 0;
    const avgROAS = totalSpend > 0 ? totalRevenue / totalSpend : 0;

    // Get unique campaigns, ad sets, and ads for filters
    const allAdsResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/ad_performance?select=campaign_name,ad_set_name,ad_name&order=campaign_name.asc`,
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    let allAds = [];
    if (allAdsResponse.ok) {
      allAds = await allAdsResponse.json();
    }

    const campaigns = [...new Set(allAds?.map(a => a.campaign_name) || [])];
    const adSets = [...new Set(allAds?.map(a => a.ad_set_name) || [])];
    const ads = [...new Set(allAds?.map(a => a.ad_name) || [])];

    return res.status(200).json({
      success: true,
      data: adData,
      metrics: {
        totalSpend: parseFloat(totalSpend.toFixed(2)),
        totalLeads,
        totalSales,
        totalRevenue: parseFloat(totalRevenue.toFixed(2)),
        avgCostPerLead: parseFloat(avgCostPerLead.toFixed(2)),
        avgCostPerSale: parseFloat(avgCostPerSale.toFixed(2)),
        avgROAS: parseFloat(avgROAS.toFixed(2)),
      },
      filters: {
        campaigns,
        adSets,
        ads,
      },
    });
  } catch (error) {
    console.error('Error fetching ad data:', error);
    return res.status(500).json({
      error: 'Failed to fetch ad data',
      message: error.message,
    });
  }
};
