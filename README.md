# Mercado SuperAmplitude

Plataforma de supermercado e delivery preparada para **https://mercado.superamplitude.com**.

## Módulos entregues

- Loja pública responsiva com departamentos, categorias e seções
- Busca por nome, marca, SKU e código de barras
- Carrinho persistente e checkout
- Pedidos com baixa transacional de estoque
- Mercado Pago Checkout Pro e PayPal Orders v2
- Painel administrativo modular em `/admin/`
- Produtos, preços, estoque e destaques
- Pedidos e fluxo de separação/entrega
- Promoções e cupons
- Zonas de delivery
- Funcionários com perfis de acesso
- Auditoria de operações
- Importação de catálogo Open Food Facts
- Importação em massa por JSONL compactado para catálogo grande
- Espelhamento de imagens para storage/CDN próprio
- Assistente de IA para pesquisa e atendimento
- Deploy em VPS com PM2 + Nginx + GitHub Actions self-hosted
- CI com MySQL, seed, sintaxe, autenticação e health check

## Ambiente

Requer Node.js 20+ e MySQL/MariaDB.

```bash
cp .env.example .env
npm install
npm run db:init
npm run seed
npm start
```

Em produção, configure obrigatoriamente `DB_*`, `JWT_SECRET` com 32+ caracteres, `ADMIN_EMAIL` e `ADMIN_PASSWORD`.

## Catálogo

Para um lote pequeno de teste via API:

```bash
npm run import:off
```

Para carga grande, use o dump JSONL em streaming:

```bash
npm run import:off:bulk
```

O importador traz identificação, código de barras, marca, embalagem, classificação, informação nutricional e origem da imagem. **Preço e estoque começam em zero**, porque devem representar a operação real do supermercado e não preços de terceiros.

## Imagens

Defina o hostname que será criado no Cloudflare:

```env
IMAGE_BASE_URL=https://imagens.mercado.superamplitude.com
IMAGE_STORAGE_DIR=/home/mercado/media/products
```

Depois da importação do catálogo:

```bash
npm run images:mirror
```

O espelhamento grava a foto no storage do projeto e troca a URL do produto pelo hostname próprio, preservando `image_source_url`, fonte e licença no banco.

## Pagamentos

Configure no `.env`:

```env
MERCADOPAGO_ACCESS_TOKEN=
MERCADOPAGO_WEBHOOK_URL=https://mercado.superamplitude.com/api/webhooks/mercadopago
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_BASE_URL=https://api-m.paypal.com
```

## VPS

O deploy padrão usa:

```text
/home/mercado/htdocs/mercado.superamplitude.com
```

O arquivo `deploy/nginx-mercado.conf` contém o proxy para a porta 3010. O workflow de produção só é liberado depois que o CI termina com sucesso.

Para registrar o self-hosted runner, use `deploy/register-runner.sh` na VPS passando o token somente por variável de ambiente. Nunca grave token de runner, credenciais de banco, chaves de pagamento ou chaves de IA no repositório.
