// Simple integration test for Auth Service
async function runTests() {
  const baseUrl = 'http://127.0.0.1:3001/api/v1/auth';
  
  console.log('1. Testing Registration...');
  const regBody = {
    email: `test${Date.now()}@example.com`,
    username: `testuser_${Date.now()}`,
    password: 'SuperSecurePassword123'
  };
  
  const regRes = await fetch(`${baseUrl}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(regBody)
  });
  
  const regData = await regRes.json();
  console.log('Registration Response:', regData);
  
  // Extract HttpOnly Set-Cookie if node fetch supports it
  const setCookieHeader = regRes.headers.get('set-cookie');
  console.log('Got Cookie:', Boolean(setCookieHeader));

  console.log('\n2. Testing Login...');
  const loginRes = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email_or_username: regBody.email,
      password: regBody.password
    })
  });
  
  const loginData = await loginRes.json();
  console.log('Login Response:', loginData);
  const loginCookie = loginRes.headers.get('set-cookie');
  
  console.log('\n3. Testing Refresh Token...');
  // Simulating the browser sending the cookie back
  const refreshRes = await fetch(`${baseUrl}/refresh`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Cookie': loginCookie?.split(';')[0] || setCookieHeader?.split(';')[0] || ''
    }
  });
  
  const refreshData = await refreshRes.json();
  console.log('Refresh Response:', refreshData);

  console.log('\n4. Testing Forgot Password...');
  const forgotRes = await fetch(`${baseUrl}/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: regBody.email })
  });
  const forgotData = await forgotRes.json();
  console.log('Forgot Password Response:', forgotData);

  console.log('\n✅ All tests finished.');
  process.exit(0);
}

runTests().catch(console.error);
