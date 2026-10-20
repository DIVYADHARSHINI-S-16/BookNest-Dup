# 📚 BookNest — Independent Bookstore Marketplace

**Discover books. Support independent bookstores. Find your next read.**

BookNest is a full-stack bookstore marketplace designed to help independent bookstores establish an online presence while enabling customers to discover, purchase, review, and explore books from multiple stores.

The platform brings together book discovery, inventory management, order processing, second-hand books, and bookstore discovery in one application.

## ✨ Key Features

### 🛍️ Customer Features
- **Authentication:** Register, log in, and access protected features.
- **Book Catalog:** Browse books and explore book details, categories, prices, and availability.
- **Search and Filtering:** Find books based on relevant catalog criteria.
- **Cart and Checkout:** Manage cart items, quantities, and checkout.
- **Order Tracking:** View order history, order details, and status updates.
- **Ratings and Reviews:** Share feedback on books.
- **Help Me Choose:** Discover books based on preferences.
- **Nearby Bookstores:** Explore participating bookstores and their locations.
- **Second-Hand Books:** Browse pre-owned books with condition information.
- **Book Requests:** Submit requests for books that customers want to find.

### 🏪 Store Owner Features
- Manage bookstore inventory and book availability.
- View and manage store orders.
- Handle customer book requests.
- Manage store-specific book listings and quantities.
- Participate in the multi-store marketplace.

### 🛡️ Admin Features
- Manage books and categories.
- Monitor inventory and bookstore listings.
- Manage customer orders and order statuses.
- Review and moderate customer reviews.
- Manage book requests.
- Access dashboard and analytics features.
- Manage second-hand book listings.

### 📦 Inventory and Order Management
BookNest supports multiple independent bookstores, store-specific inventory, and order workflows.

Order statuses include:

- Placed
- Confirmed
- Packed
- Shipped
- Delivered
- Cancelled

Second-hand book conditions include:

- Like New
- Very Good
- Good
- Acceptable

### ⚙️ Additional Capabilities
- REST API-based frontend and backend communication.
- PostgreSQL persistence.
- Redis caching support.
- Input validation and authentication middleware.
- Rate-limiting and order/cart integrity safeguards.
- Docker-based backend packaging and deployment configuration.

## 🧰 Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend | Node.js, Express.js, TypeScript |
| Database | PostgreSQL |
| Caching | Redis |
| API | REST API |
| Authentication | JWT-based authentication |
| Containerization | Docker, Docker Compose |
| Frontend deployment | Vercel configuration |
| Backend deployment | Render configuration |
| Database hosting | Neon PostgreSQL |
| Version control | Git and GitHub |

## 🏗️ Architecture

```text
                  ┌──────────────────────┐
                  │    React Frontend    │
                  │  TypeScript + Vite   │
                  └──────────┬───────────┘
                             │
                         REST API
                             │
                  ┌──────────▼───────────┐
                  │  Node.js + Express   │
                  │   Backend Services   │
                  └──────┬────────┬──────┘
                         │        │
                ┌────────▼───┐ ┌──▼─────────┐
                │ PostgreSQL │ │    Redis   │
                │  Database  │ │   Cache    │
                └────────────┘ └────────────┘
```

The frontend communicates with the backend through REST APIs. PostgreSQL stores application data, while Redis supports caching where configured.

## 📁 Project Structure

```text
BookNest/
├── client/
│   ├── src/
│   │   ├── components/
│   │   ├── context/
│   │   ├── pages/
│   │   ├── routes/
│   │   └── styles/
│   └── package.json
├── server/
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── db/
│   │   ├── middleware/
│   │   ├── routes/
│   │   └── utils/
│   ├── scripts/
│   ├── tests/
│   └── package.json
├── docker-compose.yml
├── render.yaml
├── vercel.json
├── package.json
├── package-lock.json
├── DEPLOYMENT.md
└── README.md
```

## 🚀 Getting Started

### Prerequisites

Install the following tools before running the application:

- Node.js and npm
- PostgreSQL database
- Git
- Redis, if using the caching functionality

### 1. Clone the repository

```bash
git clone https://github.com/DIVYADHARSHINI-S-16/BookNest-Dup.git
cd BookNest-Dup
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Configure the environment variables using the example files provided in the repository.

- Frontend: `client/.env.example`
- Backend: `server/.env.example`
- Production backend reference: `server/.env.production.example`

Create the corresponding local environment files and fill in the required values. Do not commit actual credentials, database URLs, JWT secrets, or other sensitive configuration.

### 4. Configure the database

Create or select a PostgreSQL database and configure the backend connection using the environment variables documented in the example files.

Apply the database migrations according to the instructions in `DEPLOYMENT.md`.

**Important:** Do not run demo-account or catalog seed scripts against a production database unless the script's purpose and effects have been explicitly reviewed.

### 5. Start the backend

Open a terminal in the `server` directory:

```bash
npm run dev
```

### 6. Start the frontend

Open another terminal in the project root:

```bash
npm run dev:client
```

Use the local URLs printed by the development servers. Ensure that the frontend API configuration points to the running backend.

For additional environment variables, build commands, and deployment details, refer to [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## 🧪 Testing and Build

The backend includes tests covering areas such as cart integrity, book requests, order lifecycle, nearby stores, and rate limiting.

Run the available test and build scripts defined in the root and backend `package.json` files before releasing changes.

## 🌐 Deployment

The repository includes deployment configuration for:

- **Frontend:** Vercel
- **Backend:** Render
- **Database:** Neon PostgreSQL
- **Caching:** Upstash Redis or another compatible Redis service

Production deployment requires the appropriate environment variables, database configuration, and service settings.

**Live application:** Add the deployed frontend URL here once available.

**Backend API:** Add the deployed backend URL here once available.

## 🔐 Security Notes

- Keep `.env` files and credentials out of version control.
- Use strong, unique production secrets.
- Configure CORS for the intended frontend origin.
- Use HTTPS in production.
- Protect administrative and store-owner routes with appropriate authorization.
- Keep demo-account creation restricted to safe development environments.
- Never publish real customer information or production credentials in screenshots or documentation.

## 🎯 Project Goals

BookNest aims to make independent bookstores more accessible through a shared online marketplace. By combining multi-store inventory, book discovery, order management, bookstore discovery, and second-hand listings, the platform provides a foundation for a more connected bookstore ecosystem.

## 👩‍💻 Development

This project is maintained in GitHub and developed using a modular frontend/backend architecture.

Contributions and suggestions for improving the application are welcome.

---

**BookNest — Bringing readers and independent bookstores closer together.** 📚
