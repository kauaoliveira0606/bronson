// api/sync-ads.js
// Daily sync from GoHighLevel to pull leads and calculate ad performance metrics

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gpthswrobafxtmsuouph.supabase.co';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const GHL_API_KEY = process.env.GHL_API_KEY_ADS;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Starting ad performance sync from GoHighLevel...');

    // Step 1: Fetch all contacts from GoHighLevel
    const contactsResponse = await fetch(
      `https://rest.gohighlevel.com/v1/contacts?locationId=${GHL_LOCATION_ID}&limit=500`,
      {
        headers: {
          'Authorization': `Bearer ${GHL_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!contactsResponse.ok) {
      throw new Error(`GoHighLevel API error: ${contactsResponse.status}`);
    }

    const contactsData = await contactsResponse.json();
    const contacts = contactsData.contacts || [];

    console.log(`Fetched ${contacts.length} contacts from GoHighLevel`);

    // Step 2: Process each contact and extract ad attribution data
    const adPerformanceMap = new Map(); // Map to aggregate data by ad
    const leadAttributions = [];

    for (const contact of contacts) {
      // Extract custom fields for ad attribution
      const customFields = contact.customFields || {};
      
      const campaignName = customFields['Ad Campaign Name'] || 'Unknown Campaign';
      const adSetName = customFields['Ad Set Name'] || 'Unknown Ad Set';
      const adName = customFields['Ad Name'] || 'Unknown Ad';
      const adSpend = parseFloat(customFields['Ad Spend']) || 0;
      const conversionValue = parseFloat(customFields['Conversion Value']) || 0;
      const leadSource = customFields['Lead Source'] || 'Direct';

      // Create a unique key for this ad combination
      const adKey = `${campaignName}|${adSetName}|${adName}`;

      // Aggregate ad performance data
      if (!adPerformanceMap.has(adKey)) {
        adPerformanceMap.set(adKey, {
          campaign_name: campaignName,
          ad_set_name: adSetName,
          ad_name: adName,
          spend: adSpend,
          leads: 0,
          sales: 0,
          revenue: 0,
        });
      }

      const adData = adPerformanceMap.get(adKey);
      adData.leads += 1;

      // Check if this lead converted (has conversion value)
      if (conversionValue > 0) {
        adData.sales += 1;
        adData.revenue += conversionValue;
      }

      // Store individual lead attribution
      leadAttributions.push({
        ghl_contact_id: contact.id,
        name: contact.firstName || contact.lastName ? `${contact.firstName || ''} ${contact.lastName || ''}`.trim() : 'Unknown',
        email: contact.email,
        phone: contact.phone,
        campaign_name: campaignName,
        ad_set_name: adSetName,
        ad_name: adName,
        spend: adSpend,
        source: leadSource,
        conversion_value: conversionValue,
        status: conversionValue > 0 ? 'sale' : 'lead',
      });
    }

    // Step 3: Insert/update ad performance data into Supabase
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const adPerformanceRecords = Array.from(adPerformanceMap.values()).map(ad => ({
      ...ad,
      date: today,
    }));

    if (adPerformanceRecords.length > 0) {
      const upsertResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/ad_performance?on_conflict=date,campaign_name,ad_set_name,ad_name`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify(adPerformanceRecords),
        }
      );

      if (!upsertResponse.ok) {
        const errorText = await upsertResponse.text();
        console.error('Supabase error response:', errorText);
        throw new Error(`Supabase error: ${upsertResponse.status}`);
      }

      console.log(`Upserted ${adPerformanceRecords.length} ad performance records`);
    }

    // Step 4: Insert/update lead attribution data into Supabase
    if (leadAttributions.length > 0) {
      const leadUpsertResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/lead_attribution?on_conflict=ghl_contact_id`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify(leadAttributions),
        }
      );

      if (!leadUpsertResponse.ok) {
        const errorText = await leadUpsertResponse.text();
        console.error('Supabase lead error response:', errorText);
        throw new Error(`Supabase lead error: ${leadUpsertResponse.status}`);
      }

      console.log(`Upserted ${leadAttributions.length} lead attribution records`);
    }

    return res.status(200).json({
      success: true,
      message: 'Ad performance sync completed successfully',
      adsProcessed: adPerformanceRecords.length,
      leadsProcessed: leadAttributions.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Sync error:', error);
    return res.status(500).json({
      error: 'Sync failed',
      message: error.message,
    });
  }
};
