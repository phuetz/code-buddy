document.addEventListener('DOMContentLoaded', () => {
    const chatHistory = document.getElementById('chat-history');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');

    let history = [];

    const appendMessage = (sender, message) => {
        const messageElement = document.createElement('div');
        messageElement.classList.add('chat-message', `${sender}-message`);
        messageElement.textContent = message;
        chatHistory.appendChild(messageElement);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    };

    sendButton.addEventListener('click', async () => {
        const message = userInput.value.trim();
        if (message) {
            appendMessage('user', message);
            userInput.value = '';

            try {
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ history, message }),
                });

                const data = await response.json();

                if (response.ok) {
                    appendMessage('ai', data.response);
                    history.push({ role: 'user', parts: [{ text: message }] });
                    history.push({ role: 'model', parts: [{ text: data.response }] });
                } else {
                    appendMessage('ai', `Error: ${data.error || 'Something went wrong.'}`);
                }
            } catch (error) {
                console.error('Error sending message:', error);
                appendMessage('ai', 'Error: Could not connect to the server.');
            }
        }
    });

    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendButton.click();
        }
    });
});