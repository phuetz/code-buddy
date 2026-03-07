document.addEventListener('DOMContentLoaded', () => {
    const incidentsList = document.getElementById('incidents-list');
    const jobsList = document.getElementById('jobs-list');
    const createIncidentForm = document.getElementById('create-incident-form');
    const createJobForm = document.getElementById('create-job-form');

    let ws;

    function connectWebSocket() {
        ws = new WebSocket(`ws://${window.location.host}`);

        ws.onopen = () => {
            console.log('WebSocket connected');
        };

        ws.onmessage = event => {
            const data = JSON.parse(event.data);
            console.log('WebSocket message:', data);
            switch (data.type) {
                case 'job_snapshot':
                    jobsList.innerHTML = '';
                    (data.jobs || []).forEach(addOrUpdateJob);
                    break;
                case 'incident_created':
                case 'incident_updated':
                    addOrUpdateIncident(data.incident);
                    break;
                case 'incident_deleted':
                    removeIncident(data.id);
                    break;
                case 'job_created':
                case 'job_updated':
                    addOrUpdateJob(data.job);
                    break;
                default:
                    console.log('Unknown message type:', data.type);
            }
        };

        ws.onclose = () => {
            console.log('WebSocket disconnected. Reconnecting...');
            setTimeout(connectWebSocket, 3000);
        };

        ws.onerror = error => {
            console.error('WebSocket error:', error);
            ws.close();
        };
    }

    function fetchIncidents() {
        fetch('/api/incidents')
            .then(res => res.json())
            .then(data => {
                incidentsList.innerHTML = '';
                data.forEach(addOrUpdateIncident);
            })
            .catch(error => console.error('Error fetching incidents:', error));
    }

    function addOrUpdateIncident(incident) {
        let incidentElement = document.getElementById(`incident-${incident.id}`);
        if (!incidentElement) {
            incidentElement = document.createElement('div');
            incidentElement.id = `incident-${incident.id}`;
            incidentElement.classList.add('item');
            incidentsList.appendChild(incidentElement);
        }

        incidentElement.innerHTML = `
            <div class="item-details">
                <h3>${incident.title}</h3>
                <p>${incident.description}</p>
                <p>Status: <span class="incident-status-${incident.status}">${incident.status}</span></p>
            </div>
            <div class="item-actions">
                <button onclick="updateIncidentStatus('${incident.id}', 'in_progress')">In Progress</button>
                <button onclick="updateIncidentStatus('${incident.id}', 'resolved')">Resolve</button>
                <button onclick="deleteIncident('${incident.id}')">Delete</button>
            </div>
        `;
    }

    function removeIncident(id) {
        const incidentElement = document.getElementById(`incident-${id}`);
        if (incidentElement) {
            incidentElement.remove();
        }
    }

    window.updateIncidentStatus = (id, status) => {
        fetch(`/api/incidents/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        })
        .then(res => res.json())
        .then(updatedIncident => console.log('Incident updated:', updatedIncident))
        .catch(error => console.error('Error updating incident:', error));
    };

    window.deleteIncident = (id) => {
        fetch(`/api/incidents/${id}`, {
            method: 'DELETE'
        })
        .then(() => console.log('Incident deleted:', id))
        .catch(error => console.error('Error deleting incident:', error));
    };

    createIncidentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = document.getElementById('incident-title').value;
        const description = document.getElementById('incident-description').value;

        try {
            const res = await fetch('/api/incidents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, description })
            });
            const newIncident = await res.json();
            console.log('New incident created:', newIncident);
            document.getElementById('incident-title').value = '';
            document.getElementById('incident-description').value = '';
        } catch (error) {
            console.error('Error creating incident:', error);
        }
    });

    function addOrUpdateJob(job) {
        let jobElement = document.getElementById(`job-${job.id}`);
        if (!jobElement) {
            jobElement = document.createElement('div');
            jobElement.id = `job-${job.id}`;
            jobElement.classList.add('item');
            jobsList.appendChild(jobElement);
        }
        jobElement.innerHTML = `
            <div class="item-details">
                <h3>Job: ${job.task}</h3>
                <p>Status: <span class="job-status-${job.status}">${job.status}</span></p>
                ${job.error ? `<p>Error: ${job.error}</p>` : ''}
            </div>
        `;
    }

    createJobForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const task = document.getElementById('job-task').value;

        try {
            const res = await fetch('/api/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task })
            });
            const newJob = await res.json();
            console.log('New job enqueued:', newJob);
            document.getElementById('job-task').value = '';
        } catch (error) {
            console.error('Error enqueuing job:', error);
        }
    });

    // Initial load
    connectWebSocket();
    fetchIncidents();
});
