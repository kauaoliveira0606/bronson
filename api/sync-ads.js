// api/sync-ads.js
// Daily sync from GoHighLevel + Meta Ads API to pull leads and calculate ad performance metrics

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gpthswrobafxtmsuouph.supabase.co';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const GHL_API_KEY = process.env.GHL_API_KEY_ADS;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Starting ad performance sync from GoHighLevel + Meta Ads...');

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

    // Step 2: Fetch Meta Ads data if credentials are available
    let metaAdsData = {};
    if (META_ACCESS_TOKEN && META_AD_ACCOUNT_ID) {
      try {
        console.log('Fetching Meta Ads data...');
        const metaResponse = await fetch(
          `https://graph.facebook.com/v18.0/${META_AD_ACCOUNT_ID}/campaigns?fields=id,name,spend,insights.date_preset(last_7d){spend,impressions,clicks,actions}&access_token=${META_ACCESS_TOKEN}`,
          { method: 'GET' }
        );

        if (metaResponse.ok) {
          const metaDataRaw = await metaResponse.json();
          const campaigns = metaDataRaw.data || [];

          // Also fetch ad sets and ads for detailed breakdown
          for (const campaign of campaigns) {
            const adSetsResponse = await fetch(
              `https://graph.facebook.com/v18.0/${campaign.id}/adsets?fields=id,name,spend,insights.date_preset(last_7d){spend,impressions,clicks}&access_token=${META_ACCESS_TOKEN}`,
              { method: 'GET' }
            );

            if (adSetsResponse.ok) {
              const adSetsData = await adSetsResponse.json();
              const adSets = adSetsData.data || [];

              for (const adSet of adSets) {
                const adsResponse = await fetch(
                  `https://graph.facebook.com/v18.0/${adSet.id}/ads?fields=id,name,spend,insights.date_preset(last_7d){spend,impressions,clicks}&access_token=${META_ACCESS_TOKEN}`,
                  { method: 'GET' }
                );

                if (adsResponse.ok) {
                  const adsData = await adsResponse.json();
                  const ads = adsData.data || [];

                  for (const ad of ads) {
                    const adKey = `${campaign.name}|${adSet.name}|${ad.name}`;
                    const spend = ad.spend || 0;
                    const insights = ad.insights?.data?.[0] || {};

                    metaAdsData[adKey] = {
                      campaign_name: campaign.name,
                      ad_set_name: adSet.name,
                      ad_name: ad.name,
                      meta_spend: parseFloat(spend),
                      meta_impressions: insights.impressions || 0,
                      meta_clicks: insights.clicks || 0,
                    };
                  }
                }
              }
            }
          }

          console.log(`Fetched ${Object.keys(metaAdsData).length} ads from Meta`);
        }
      } catch (metaError) {
        console.warn('Meta Ads API fetch warning:', metaError.message);
        // Continue without Meta data if there's an error
      }
    }

    // Step 3: Process each contact and extract ad attribution data
    const adPerformanceMap = new Map();
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
        const metaData = metaAdsData[adKey] || {};
        adPerformanceMap.set(adKey, {
          campaign_name: campaignName,
          ad_set_name: adSetName,
          ad_name: adName,
          spend: metaData.meta_spend || adSpend, // Prefer Meta spend if available
          meta_impressions: metaData.meta_impressions || 0,
          meta_clicks: metaData.meta_clicks || 0,
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

    // Step 4: Insert/update ad performance data into Supabase
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const adPerformanceRecords = Array.from(adPerformanceMap.values()).map(ad => ({
      ...ad,
      date: today,
      cost_per_lead: ad.leads > 0 ? ad.spend / ad.leads : 0,
      cost_per_sale: ad.sales > 0 ? ad.spend / ad.sales : 0,
      roas: ad.spend > 0 ? ad.revenue / ad.spend : 0,
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

    // Step 5: Insert/update lead attribution data into Supabase
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
      metaAdsIntegrated: Object.keys(metaAdsData).length > 0,
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
