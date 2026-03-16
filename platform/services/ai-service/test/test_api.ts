const API_URL = process.env.AI_SERVICE_URL || 'http://localhost:8005';

async function testAIService() {
  console.log('🧪 Testing AI Service...\n');
  console.log(`API URL: ${API_URL}\n`);

  // Test 1: Health Check
  console.log('1. Testing Health Endpoint...');
  try {
    const healthRes = await fetch(`${API_URL}/health`);
    const health = await healthRes.json();
    console.log(`   ✅ Health: ${JSON.stringify(health)}\n`);
  } catch (error: any) {
    console.log(`   ❌ Health check failed: ${error.message}\n`);
  }

  // Test 2: Execute Task (Sync)
  console.log('2. Testing Execute Endpoint (Sync)...');
  try {
    const executeRes = await fetch(`${API_URL}/ai/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': 'test-user-123',
      },
      body: JSON.stringify({
        projectId: 'test-project-123',
        prompt: 'Write a simple hello world function in TypeScript',
        context: {
          files: ['src/index.ts'],
        },
      }),
    });

    if (executeRes.ok) {
      const result = await executeRes.json();
      console.log(`   ✅ Execute response:`);
      console.log(`   Task ID: ${result.id}`);
      console.log(`   Status: ${result.status}`);
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
      if (result.data) {
        console.log(`   Data: ${JSON.stringify(result.data).substring(0, 200)}...`);
      }
      console.log();
    } else {
      const error = await executeRes.text();
      console.log(`   ❌ Execute failed (${executeRes.status}): ${error}\n`);
    }
  } catch (error: any) {
    console.log(`   ❌ Execute request failed: ${error.message}\n`);
  }

  // Test 3: Execute Stream
  console.log('3. Testing Execute Stream Endpoint...');
  try {
    const streamRes = await fetch(`${API_URL}/ai/execute/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': 'test-user-123',
      },
      body: JSON.stringify({
        projectId: 'test-project-123',
        prompt: 'Create a simple greeting function',
      }),
    });

    if (streamRes.ok) {
      console.log(`   ✅ Stream started`);
      const reader = streamRes.body?.getReader();
      const decoder = new TextDecoder();
      let chunks = 0;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          chunks++;
          
          // Only show first few chunks
          if (chunks <= 3) {
            console.log(`   Chunk ${chunks}: ${chunk.substring(0, 100)}...`);
          }
        }
      }
      console.log(`   Total chunks: ${chunks}\n`);
    } else {
      const error = await streamRes.text();
      console.log(`   ❌ Stream failed (${streamRes.status}): ${error}\n`);
    }
  } catch (error: any) {
    console.log(`   ❌ Stream request failed: ${error.message}\n`);
  }

  // Test 4: Get Task Status
  console.log('4. Testing Task Status Endpoint...');
  try {
    const statusRes = await fetch(`${API_URL}/ai/tasks/test-task-123`);
    
    if (statusRes.ok) {
      const status = await statusRes.json();
      console.log(`   ✅ Task status: ${JSON.stringify(status)}\n`);
    } else if (statusRes.status === 404) {
      console.log(`   ⚠️ Task not found (expected for test ID)\n`);
    } else {
      console.log(`   ❌ Status check failed (${statusRes.status})\n`);
    }
  } catch (error: any) {
    console.log(`   ❌ Status request failed: ${error.message}\n`);
  }

  // Test 5: Unauthorized Request
  console.log('5. Testing Authorization...');
  try {
    const unauthRes = await fetch(`${API_URL}/ai/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Missing X-User-Id header
      },
      body: JSON.stringify({
        projectId: 'test-project-123',
        prompt: 'Test prompt',
      }),
    });

    if (unauthRes.status === 401) {
      console.log(`   ✅ Authorization working (401 returned)\n`);
    } else {
      console.log(`   ⚠️ Expected 401, got ${unauthRes.status}\n`);
    }
  } catch (error: any) {
    console.log(`   ❌ Auth test failed: ${error.message}\n`);
  }

  // Test 6: Validation Error
  console.log('6. Testing Validation...');
  try {
    const validRes = await fetch(`${API_URL}/ai/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': 'test-user-123',
      },
      body: JSON.stringify({
        // Missing projectId and prompt
      }),
    });

    if (validRes.status === 400) {
      console.log(`   ✅ Validation working (400 returned)\n`);
    } else {
      console.log(`   ⚠️ Expected 400, got ${validRes.status}\n`);
    }
  } catch (error: any) {
    console.log(`   ❌ Validation test failed: ${error.message}\n`);
  }

  console.log('✅ AI Service tests completed!\n');
}

testAIService().catch(console.error);
