import http from 'http';
import { exec } from 'child_process';

const serverProcess = exec('npm start');

serverProcess.stdout.on('data', (data) => {
  console.log(`Server: ${data}`);
  if (data.includes('Server is running')) {
    setTimeout(() => {
      http.get('http://localhost:3000/health', (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          console.log(`Health Check: ${data}`);
          serverProcess.kill();
          if (data === 'OK') {
            process.exit(0);
          } else {
            process.exit(1);
          }
        });
      }).on('error', (err) => {
        console.error(`Health Check Error: ${err.message}`);
        serverProcess.kill();
        process.exit(1);
      });
    }, 5000); // Give server 5 seconds to start
  }
});

serverProcess.stderr.on('data', (data) => {
  console.error(`Server Error: ${data}`);
});

serverProcess.on('close', (code) => {
  console.log(`Server process exited with code ${code}`);
});