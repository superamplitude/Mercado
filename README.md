# Mercado SuperAmplitude

Plataforma de supermercado e delivery preparada para **https://mercado.superamplitude.com**.

## Módulos

- Loja pública responsiva
- Departamentos, categorias e seções
- Busca por nome, marca, SKU e código de barras
- Carrinho e checkout
- Pedidos e delivery
- Estoque e preço por produto
- Promoções e cupons
- Painel administrativo
- Perfis de funcionários
- Importação de catálogo e imagens com rastreabilidade da fonte
- Assistente de IA preparado para busca e atendimento
- Integrações de pagamento preparadas para Mercado Pago e PayPal
- Cloudflare/CDN por variável de ambiente
- Deploy em VPS com PM2 + Nginx + GitHub Actions self-hosted

## Início rápido

```bash
cp .env.example .env
npm install
npm run db:init
npm run seed
npm start
```

O projeto usa Node.js 20+ e MySQL/MariaDB.

## Imagens

Defina `IMAGE_BASE_URL` para o hostname que será criado no Cloudflare. Exemplo:

```env
IMAGE_BASE_URL=https://imagens.mercado.superamplitude.com
```

Nunca grave credenciais, tokens de runner, chaves de pagamento ou chaves de IA no repositório.
