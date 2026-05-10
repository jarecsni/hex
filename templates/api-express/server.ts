// Reference Express stub — boots an HTTP server on the configured port.
import express from 'express';

const app = express();
const port = {{ port }};

app.get('/', (_req, res) => {
  res.json({ ok: true, framework: 'express' });
});

app.listen(port, () => {
  console.log(`api-express listening on :${port}`);
});
