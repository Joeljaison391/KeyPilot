# KeyPilot

🚀 **Production-grade AI API Gateway Service** powered by Redis for intelligent request routing, semantic caching, and advanced analytics.

## 🎯 Overview

KeyPilot is a sophisticated Express.js gateway service that provides intelligent API request routing with semantic analysis, Redis-powered caching, and comprehensive analytics. Built for production environments with enterprise-grade security, monitoring, and scalability.

## ✨ Key Features

### � **Authentication & Security**
- JWT-based token authentication
- API key management with encryption
- Rate limiting and request validation
- Helmet.js security headers
- CORS configuration

### 🧠 **Intelligent Routing**
- Semantic intent analysis and matching
- Template-based API routing
- Confidence scoring for optimal selection
- Vector embedding similarity matching

### ⚡ **Redis-Powered Performance**
- Semantic caching with TTL management
- Real-time analytics and insights
- Redis Streams for event logging
- Intent trend analysis and clustering

### 📊 **Advanced Analytics**
- Cache inspector with clustering analysis
- Intent trend detection and forecasting
- Performance metrics and optimization
- Feedback loop for continuous improvement

### 🔧 **Developer Experience**
- Comprehensive testing framework (100+ tests)
- TypeScript with strict type checking
- Docker containerization
- Hot reload development environment
- Extensive documentation and examples

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Client Apps   │────│   KeyPilot API   │────│   External APIs │
│                 │    │    Gateway       │    │  (OpenAI, etc.) │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                       ┌──────────────┐
                       │    Redis     │
                       │   • Cache    │
                       │   • Sessions │
                       │   • Analytics│
                       │   • Streams  │
                       └──────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- Redis 4.6+
- TypeScript
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Joeljaison391/KeyPilot.git
   cd KeyPilot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start Redis**
   ```bash
   # Using Docker
   docker run -d -p 6379:6379 redis:alpine
   
   # Or using docker-compose
   docker-compose up redis -d
   ```

5. **Run the service**
   ```bash
   # Development mode
   npm run dev
   
   # Production build
   npm run build
   npm start
   ```

## 📋 API Endpoints

### 🔐 Authentication
```http
POST /auth/login              # User authentication
GET  /auth/validate           # Token validation
POST /auth/add-key            # Add API key
PUT  /auth/add-key            # Update API key
DELETE /auth/logout           # User logout
```

### 🚀 Proxy & Routing
```http
POST /api/proxy               # Intelligent API proxy
POST /api/proxy/test          # Semantic testing playground
```

### 📊 Analytics
```http
GET  /api/cache-inspector     # Cache analysis and clustering
GET  /api/intent-trends       # Intent trend analysis
GET  /api/feedback-stats      # Feedback statistics
```

### 💬 Feedback
```http
POST /api/feedback            # Submit feedback
```

### 🩺 Health & Monitoring
```http
GET  /health                  # Service health
GET  /health/ready            # Readiness check
GET  /health/live             # Liveness check
```

## 🧪 Testing

KeyPilot includes a comprehensive testing framework with 100+ test cases:

```bash
# Run all tests
npm test

# Unit tests only
npm run test:unit

# Integration tests
npm run test:integration

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

## 🐳 Docker Deployment

### Development
```bash
docker-compose up
```

### Production
```bash
# Build image
docker build -t keypilot:latest .

# Run container
docker run -d \
  --name keypilot \
  -p 3000:3000 \
  -e REDIS_URL=redis://redis:6379 \
  keypilot:latest
```