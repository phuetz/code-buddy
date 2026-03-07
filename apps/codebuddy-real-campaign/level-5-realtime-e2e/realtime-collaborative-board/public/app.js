const ws = new WebSocket(`ws://${window.location.host}`);

const itemsDiv = document.getElementById('items');
const createItemForm = document.getElementById('create-item-form');
const newItemTitleInput = document.getElementById('new-item-title');

const renderItem = (item) => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'item';
    itemDiv.id = `item-${item.id}`;

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = item.title;
    nameInput.addEventListener('change', (e) => {
        updateItem(item.id, { title: e.target.value });
    });

    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', () => {
        deleteItem(item.id);
    });

    itemDiv.appendChild(nameInput);
    itemDiv.appendChild(deleteButton);
    return itemDiv;
};

const fetchItems = async () => {
    const res = await fetch('/api/items');
    const items = await res.json();
    itemsDiv.innerHTML = '';
    items.forEach(item => itemsDiv.appendChild(renderItem(item)));
};

const createItem = async (title) => {
    await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
    });
    newItemTitleInput.value = '';
};

const updateItem = async (id, updates) => {
    await fetch(`/api/items/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
    });
};

const deleteItem = async (id) => {
    await fetch(`/api/items/${id}`, {
        method: 'DELETE'
    });
};

createItemForm.addEventListener('submit', (e) => {
    e.preventDefault();
    createItem(newItemTitleInput.value);
});

ws.onopen = () => {
    console.log('WebSocket connected');
    fetchItems(); // Fetch initial items on connect
};

ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    console.log('WebSocket message received:', message);

    switch (message.type) {
        case 'snapshot':
            itemsDiv.innerHTML = '';
            message.payload.forEach(item => itemsDiv.appendChild(renderItem(item)));
            break;
        case 'item.created':
            itemsDiv.appendChild(renderItem(message.payload));
            break;
        case 'item.updated':
            const existingItemDiv = document.getElementById(`item-${message.payload.id}`);
            if (existingItemDiv) {
                itemsDiv.replaceChild(renderItem(message.payload), existingItemDiv);
            }
            break;
        case 'item.deleted':
            const itemToDelete = document.getElementById(`item-${message.payload.id}`);
            if (itemToDelete) {
                itemToDelete.remove();
            }
            break;
    }
};

ws.onclose = () => {
    console.log('WebSocket disconnected');
};

ws.onerror = (error) => {
    console.error('WebSocket error:', error);
};
