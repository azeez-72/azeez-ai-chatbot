import { ChatMemory } from './chat-memory';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Serve static files from public directory
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return env.ASSETS.fetch(request);
    }
    
    // Handle API routes
    if (url.pathname === '/api/chat') {
      return handleChatRequest(request, env);
    }
    
    return new Response('Not Found', { status: 404 });
  },
};

async function handleChatRequest(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { message } = await request.json();
    
    if (!message) {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get or create chat memory Durable Object
    const memoryId = env.CHAT_MEMORY.idFromName('default-chat');
    const memoryStub = env.CHAT_MEMORY.get(memoryId);
    
    // Get chat history from memory
    const history = await memoryStub.getHistory();
    
    // Prepare messages for Llama 3.3
    const messages = [
      { role: 'system', content: 'You are a helpful AI assistant. Be concise and friendly.' },
      ...history,
      { role: 'user', content: message }
    ];

    // Call Cloudflare Workers AI with Llama 3.3
    const aiResponse = await env.AI.run('@cf/meta/llama-3.3-70b-instruct', {
      messages: messages,
      max_tokens: 500,
      temperature: 0.7,
    });

    const response = aiResponse.response || 'Sorry, I could not generate a response.';
    
    // Store conversation in memory
    await memoryStub.addMessage(message, response);

    return new Response(JSON.stringify({ response }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Chat error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
