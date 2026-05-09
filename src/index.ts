import express, { Request, Response } from 'express';
import 'dotenv/config';

const app = express();
app.use(express.json());

app.post('/vapi/webhook', (req: Request, res: Response) => {
    console.log(JSON.stringify(req.body, null, 2));
    res.json({ results: [] });
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
    console.log(`Webhook server listening on :${PORT}`);
});
