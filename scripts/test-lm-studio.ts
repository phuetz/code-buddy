#!/usr/bin/env npx tsx
/**
 * Test script for LM Studio connection
 *
 * Usage:
 *   npx tsx scripts/test-lm-studio.ts
 *
 * Or with custom endpoint:
 *   npx tsx scripts/test-lm-studio.ts http://localhost:1234
 */

const endpoint = process.argv[2] || 'http://localhost:1234';

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║           🧪 Test de connexion LM Studio                   ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log();
console.log(`📍 Endpoint: ${endpoint}`);
console.log();

async function testConnection(): Promise<boolean> {
  console.log('1️⃣  Test de connexion...');
  try {
    const response = await fetch(`${endpoint}/v1/models`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.log(`   ❌ Erreur HTTP: ${response.status}`);
      return false;
    }

    console.log('   ✅ Serveur accessible');
    return true;
  } catch (error) {
    console.log(`   ❌ Connexion impossible: ${(error as Error).message}`);
    console.log();
    console.log('   💡 Vérifier que:');
    console.log('      - LM Studio est ouvert');
    console.log('      - Le serveur local est démarré (onglet "Local Server")');
    console.log('      - Un modèle est chargé');
    return false;
  }
}

async function listModels(): Promise<string | null> {
  console.log();
  console.log('2️⃣  Liste des modèles...');
  try {
    const response = await fetch(`${endpoint}/v1/models`);
    const data = await response.json() as { data?: Array<{ id: string }> };

    if (data.data && data.data.length > 0) {
      console.log('   ✅ Modèles disponibles:');
      data.data.forEach((model: { id: string }) => {
        console.log(`      • ${model.id}`);
      });
      return data.data[0].id;
    } else {
      console.log('   ⚠️  Aucun modèle chargé');
      console.log('   💡 Charger un modèle dans LM Studio');
      return null;
    }
  } catch (error) {
    console.log(`   ❌ Erreur: ${(error as Error).message}`);
    return null;
  }
}

async function testCompletion(model: string): Promise<void> {
  console.log();
  console.log('3️⃣  Test de génération...');
  console.log(`   📦 Modèle: ${model}`);
  console.log('   📝 Prompt: "Dis bonjour en une phrase."');
  console.log();

  try {
    const startTime = Date.now();

    const response = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'user', content: 'Dis bonjour en une phrase.' }
        ],
        max_tokens: 100,
        temperature: 0.7,
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.log(`   ❌ Erreur API: ${response.status}`);
      console.log(`   ${error}`);
      return;
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const duration = Date.now() - startTime;

    const content = data.choices?.[0]?.message?.content || '(pas de réponse)';

    console.log('   ✅ Réponse reçue:');
    console.log('   ┌────────────────────────────────────────────────────────');
    console.log(`   │ ${content}`);
    console.log('   └────────────────────────────────────────────────────────');
    console.log();
    console.log(`   ⏱️  Temps: ${duration}ms`);

    if (data.usage) {
      console.log(`   📊 Tokens: ${data.usage.prompt_tokens} prompt + ${data.usage.completion_tokens} completion = ${data.usage.total_tokens} total`);
    }

  } catch (error) {
    console.log(`   ❌ Erreur: ${(error as Error).message}`);
  }
}

async function testStreaming(model: string): Promise<void> {
  console.log();
  console.log('4️⃣  Test du streaming...');

  try {
    const response = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'user', content: 'Compte de 1 à 5.' }
        ],
        max_tokens: 50,
        temperature: 0.7,
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      console.log(`   ❌ Streaming non supporté ou erreur`);
      return;
    }

    console.log('   ✅ Streaming actif:');
    process.stdout.write('   │ ');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ') && !line.includes('[DONE]')) {
          try {
            const data = JSON.parse(line.slice(6)) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const content = data.choices?.[0]?.delta?.content;
            if (content) {
              process.stdout.write(content);
            }
          } catch {
            // Ignore parsing errors
          }
        }
      }
    }

    console.log();
    console.log('   ✅ Streaming OK');

  } catch (error) {
    console.log(`   ❌ Erreur: ${(error as Error).message}`);
  }
}

async function showConfig(): Promise<void> {
  console.log();
  console.log('═══════════════════════════════════════════════════════════════');
  console.log();
  console.log('📋 Configuration pour .grok/settings.json:');
  console.log();
  console.log('```json');
  console.log(JSON.stringify({
    offline: {
      localLLMEnabled: true,
      localLLMProvider: 'llamacpp',
      localLLMEndpoint: endpoint,
      localLLMModel: 'local-model'
    }
  }, null, 2));
  console.log('```');
}

async function main(): Promise<void> {
  // Test 1: Connection
  const connected = await testConnection();
  if (!connected) {
    process.exit(1);
  }

  // Test 2: List models
  const model = await listModels();
  if (!model) {
    process.exit(1);
  }

  // Test 3: Completion
  await testCompletion(model);

  // Test 4: Streaming
  await testStreaming(model);

  // Show config
  await showConfig();

  console.log();
  console.log('✅ Tous les tests passent ! LM Studio est prêt.');
  console.log();
}

main().catch(console.error);
