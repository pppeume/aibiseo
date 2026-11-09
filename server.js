// K-IoT PLUS 업무관리(R&R) 서버
import 'dotenv/config';
import express from 'express';
import rrRouter, { startScheduler } from './rr/routes.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));
app.use('/api/rr', rrRouter);

app.listen(port, () => {
  console.log(`🗂️  K-IoT PLUS 업무관리 서버 시작: http://localhost:${port}`);
  startScheduler();
});
