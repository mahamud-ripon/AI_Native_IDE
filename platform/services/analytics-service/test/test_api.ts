const API_URL = process.env.ANALYTICS_SERVICE_URL || 'http://localhost:8007';
// Use empty string if ADMIN_API_KEY not set (matches server default)
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';

async function testAnalyticsService() {
  console.log('🧪 Testing Analytics Service...\n');
  console.log(`API URL: ${API_URL}`);
  console.log(`Admin API Key: ${ADMIN_API_KEY}\n`);

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ADMIN_API_KEY}`,
  };

  // Test 1: Health Check
  console.log('1. Testing Health Endpoint...');
  try {
    const healthRes = await fetch(`${API_URL}/health`);
    const health = await healthRes.json();
    console.log(`   ✅ Health: ${JSON.stringify(health)}\n`);
  } catch (error: any) {
    console.log(`   ❌ Health check failed: ${error.message}\n`);
  }

  // Test 2: Overview Analytics (Admin)
  console.log('2. Testing Overview Analytics...');
  try {
    const overviewRes = await fetch(`${API_URL}/api/v1/admin/analytics/overview`, { headers });
    
    if (overviewRes.ok) {
      const overview = await overviewRes.json();
      console.log(`   ✅ Overview:`);
      console.log(`   Daily: ${JSON.stringify(overview.daily || overview.error || 'N/A')}`);
      console.log(`   Weekly: ${JSON.stringify(overview.weekly || 'N/A')}`);
      console.log(`   Monthly: ${JSON.stringify(overview.monthly || 'N/A')}\n`);
    } else {
      const error = await overviewRes.text();
      console.log(`   ❌ Overview failed (${overviewRes.status}): ${error}\n`);
    }
  } catch (error: any) {
    console.log(`   ❌ Overview request failed: ${error.message}\n`);
  }

  // Test 3: Usage Analytics
  console.log('3. Testing Usage Analytics...');
  try {
    const usageRes = await fetch(`${API_URL}/api/v1/admin/analytics/usage?period=week`, { headers });
    
    if (usageRes.ok) {
      const usage = await usageRes.json();
      console.log(`   ✅ Usage: ${JSON.stringify(usage).substring(0, 200)}...\n`);
    } else {
      const error = await usageRes.text();
      console.log(`   ❌ Usage failed (${usageRes.status}): ${error}\n`);
    }
  } catch (error: any) {
    console.log(`   ❌ Usage request failed: ${error.message}\n`);
  }

  // Test 4: Revenue Analytics
  console.log('4. Testing Revenue Analytics...');
  try {
    const revenueRes = await fetch(`${API_URL}/api/v1/admin/analytics/revenue`, { headers });
    
    if (revenueRes.ok) {
      const revenue = await revenueRes.json();
      console.log(`   ✅ Revenue:`);
      console.log(`   MRR: ${revenue.mrr || 'N/A'}`);
      console.log(`   ARR: ${revenue.arr || 'N/A'}`);
      console.log(`   Churn Rate: ${revenue.churnRate || 'N/A'}\n`);
    } else {
      const error = await revenueRes.text();
      console.log(`   ❌ Revenue failed (${revenueRes.status}): ${error}\n`);
    }
  } catch (error: any) {
    console.log(`   ❌ Revenue request failed: ${error.message}\n`);
  }

  // Test 5: List Feature Flags
  console.log('5. Testing Feature Flags List...');
  try {
    const flagsRes = await fetch(`${API_URL}/api/v1/admin/feature-flags`, { headers });
    
    if (flagsRes.ok) {
      const flags = await flagsRes.json();
      console.log(`   ✅ Feature flags: ${JSON.stringify(flags).substring(0, 200)}...\n`);
    } else {
      const error = await flagsRes.text();
      console.log(`   ❌ Flags failed (${flagsRes.status}): ${error}\n`);
    }
  } catch (error: any) {
    console.log(`   ❌ Flags request failed: ${error.message}\n`);
  }

  // Test 6: Create Feature Flag
  console.log('6. Testing Create Feature Flag...');
  try {
    const createRes = await fetch(`${API_URL}/api/v1/admin/feature-flags`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        key: `test_flag_${Date.now()}`,
        name: 'Test Feature Flag',
        description: 'Created by test script',
        enabled: true,
        targetPlans: ['free', 'pro'],
        rolloutPercentage: 50,
      }),
    });
    
    if (createRes.ok) {
      const flag = await createRes.json();
      console.log(`   ✅ Created flag: ${JSON.stringify(flag).substring(0, 150)}...\n`);
    } else if (createRes.status === 400) {
      const error = await createRes.text();
      console.log(`   ⚠️ Validation error (expected): ${error.substring(0, 100)}\n`);
    } else {
      const error = await createRes.text();
      console.log(`   ❌ Create failed (${createRes.status}): ${error}\n`);
    }
  } catch (error: any) {
    console.log(`   ❌ Create request failed: ${error.message}\n`);
  }

  // Test 7: Evaluate Feature Flag (Internal)
  console.log('7. Testing Feature Flag Evaluation...');
  try {
    const evalRes = await fetch(`${API_URL}/api/v1/features/evaluate?key=test_feature&userId=test-user-123&plan=pro`);
    
    if (evalRes.ok) {
      const result = await evalRes.json();
      console.log(`   ✅ Evaluation: ${JSON.stringify(result)}\n`);
    } else {
      const error = await evalRes.text();
      console.log(`   ❌ Evaluation failed (${evalRes.status}): ${error}\n`);
    }
  } catch (error: any) {
    console.log(`   ❌ Evaluation request failed: ${error.message}\n`);
  }

  // Test 8: Unauthorized Request
  console.log('8. Testing Authorization...');
  try {
    const unauthRes = await fetch(`${API_URL}/api/v1/admin/analytics/overview`);
    
    if (unauthRes.status === 401) {
      console.log(`   ✅ Authorization working (401 returned)\n`);
    } else {
      console.log(`   ⚠️ Expected 401, got ${unauthRes.status}\n`);
    }
  } catch (error: any) {
    console.log(`   ❌ Auth test failed: ${error.message}\n`);
  }

  // Test 9: Invalid API Key
  console.log('9. Testing Invalid API Key...');
  try {
    const invalidRes = await fetch(`${API_URL}/api/v1/admin/analytics/overview`, {
      headers: {
        'Authorization': 'Bearer invalid-key',
      },
    });
    
    if (invalidRes.status === 403) {
      console.log(`   ✅ Forbidden working (403 returned)\n`);
    } else {
      console.log(`   ⚠️ Expected 403, got ${invalidRes.status}\n`);
    }
  } catch (error: any) {
    console.log(`   ❌ Invalid key test failed: ${error.message}\n`);
  }

  console.log('✅ Analytics Service tests completed!\n');
}

testAnalyticsService().catch(console.error);
