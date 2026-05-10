// Reference Fastify stub — boots an HTTP server on the configured port.
import Fastify from 'fastify';

const app = Fastify({ logger: true });
const port = {{ port }};

app.get('/', async () => ({ ok: true, framework: 'fastify' }));

app.listen({ port }).then(() => {
  console.log(`api-fastify listening on :${port}`);
});
