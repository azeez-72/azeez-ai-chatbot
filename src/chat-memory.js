export class ChatMemory {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async addMessage(userMessage, botResponse) {
    const messages = await this.getHistory();
    messages.push({ role: 'user', content: userMessage });
    messages.push({ role: 'assistant', content: botResponse });
    
    // Keep only last 10 messages to manage memory
    if (messages.length > 10) {
      messages.splice(0, messages.length - 10);
    }
    
    await this.state.storage.put('messages', messages);
  }

  async getHistory() {
    return await this.state.storage.get('messages') || [];
  }

  async clearHistory() {
    await this.state.storage.delete('messages');
  }
}
