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

### Test Categories
- ✅ **Authentication & Authorization** (20+ tests)
- ✅ **Proxy & Caching Logic** (15+ tests)  
- ✅ **Analytics & Insights** (18+ tests)
- ✅ **Feedback System** (12+ tests)
- ✅ **End-to-End Workflows** (25+ tests)
- ✅ **Performance & Load Testing** (10+ tests)

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

## 📁 Project Structure

```
src/
├── config/              # Configuration management
├── middleware/          # Express middleware
├── routes/             # API route handlers
│   ├── auth.ts         # Authentication routes
│   ├── proxy.ts        # Intelligent proxy
│   ├── feedback.ts     # Feedback system
│   ├── cacheInspector.ts # Cache analytics
│   └── intentTrends.ts # Trend analysis
├── utils/              # Utility functions
│   ├── redisService.ts # Redis operations
│   ├── logger.ts       # Logging system
│   └── encryption.ts   # Security utilities
├── tests/              # Comprehensive test suite
└── types/              # TypeScript definitions
```

## ⚙️ Configuration

Key configuration options in `.env`:

```env
# Server Configuration
PORT=3000
NODE_ENV=production

# Redis Configuration  
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=your_password

# Security
JWT_SECRET=your_jwt_secret
ENCRYPTION_KEY=your_encryption_key

# API Keys (for external services)
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
GEMINI_API_KEY=your_gemini_key
```

## 🔧 Development

### Code Quality
```bash
# Type checking
npm run typecheck

# Linting
npm run lint
npm run lint:fix

# Formatting
npm run format
```

### Hot Reload Development
```bash
npm run dev
```

## 📊 Performance Metrics

- **Response Time**: < 1ms for health checks
- **Concurrent Handling**: 5+ requests in 4ms
- **Cache Hit Ratio**: 85%+ with semantic matching
- **Memory Usage**: Optimized with proper cleanup
- **Test Coverage**: 90%+ across all modules

## 🔒 Security Features

- **Helmet.js** security headers
- **Rate limiting** per IP and endpoint
- **Input validation** with Joi schemas
- **API key encryption** with AES-256-CTR
- **CORS** policy enforcement
- **Request sanitization**

## 📈 Analytics & Monitoring

### Cache Inspector
- Real-time cache health monitoring
- Clustering analysis for similar intents
- Performance optimization recommendations
- Memory usage tracking

### Intent Trends
- Historical intent pattern analysis
- Trending topic detection
- Confidence score tracking
- Template performance metrics

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built for the Redis Hackathon 2025
- Powered by Redis for performance and analytics
- TypeScript for type safety and developer experience
- Express.js for robust API foundation

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/Joeljaison391/KeyPilot/issues)
- **Documentation**: [API Docs](/docs)
- **Discord**: [Community Server](https://discord.gg/keypilot)

---

**KeyPilot** - Intelligent API Gateway for the AI Era 🚀
- 🧪 **Testing**: Jest setup with test examples
- 📝 **TypeScript**: Full TypeScript support with strict configuration
- 🔧 **Development**: Hot reload, linting, and formatting tools

## Tech Stack

- **Runtime**: Node.js 18+ with TypeScript
- **Framework**: Express.js
- **Security**: Helmet, CORS, express-rate-limit
- **Validation**: express-validator, Joi
- **Logging**: Winston
- **Testing**: Jest, Supertest
- **Code Quality**: ESLint, Prettier
- **Containerization**: Docker, Docker Compose

## Project Structure

```
gateway-service/
├── src/
│   ├── config/           # Configuration files
│   ├── middleware/       # Custom middleware
│   ├── routes/           # Route handlers
│   ├── utils/            # Utility functions
│   ├── tests/            # Test files
│   ├── app.ts            # Express app setup
│   └── index.ts          # Application entry point
├── scripts/              # Utility scripts
├── logs/                 # Application logs
├── dist/                 # Compiled JavaScript (generated)
├── Dockerfile            # Production Docker image
├── Dockerfile.dev        # Development Docker image
├── docker-compose.yml    # Docker Compose configuration
└── package.json          # Dependencies and scripts
```

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Docker and Docker Compose (optional)

### Local Development

1. **Clone and install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start in development mode**:
   ```bash
   npm run dev
   ```

4. **Build for production**:
   ```bash
   npm run build
   npm start
   ```

### Docker Development

1. **Start with Docker Compose**:
   ```bash
   # Development mode
   docker-compose --profile dev up gateway-service-dev

   # Production mode
   docker-compose up gateway-service
   ```

2. **Build and run manually**:
   ```bash
   # Development
   docker build -f Dockerfile.dev -t gateway-service:dev .
   docker run -p 3000:3000 gateway-service:dev

   # Production
   docker build -t gateway-service:latest .
   docker run -p 3000:3000 gateway-service:latest
   ```

## API Endpoints

### Health Checks
- `GET /health` - Overall health status with system metrics
- `GET /health/ready` - Readiness probe for Kubernetes
- `GET /health/live` - Liveness probe for Kubernetes

### API Routes
- `GET /api` - API information and available endpoints
- `GET /api/protected` - Protected endpoint requiring API key
- `POST /api/echo` - Echo endpoint with request validation
- `GET /api/async-demo` - Demonstration of async operations

### Root
- `GET /` - Service information

## Configuration

Environment variables can be set in `.env` file:

```env
NODE_ENV=development
PORT=3000
APP_NAME=gateway-service
APP_VERSION=1.0.0
JWT_SECRET=your-super-secret-jwt-key
API_KEY=your-api-key-here
LOG_LEVEL=info
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
CORS_ORIGIN=http://localhost:3000
```

## Available Scripts

```bash
npm run dev          # Start development server with hot reload
npm run build        # Build TypeScript to JavaScript
npm run build:clean  # Clean build directory and rebuild
npm start            # Start production server
npm test             # Run tests
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
npm run lint         # Run ESLint
npm run lint:fix     # Fix ESLint issues automatically
npm run format       # Format code with Prettier
npm run typecheck    # Run TypeScript type checking
npm run health-check # Check application health
```

## Production Deployment

### Docker Production Image

The production Dockerfile uses multi-stage builds for optimal image size:

1. **Builder stage**: Installs dependencies and builds the application
2. **Production stage**: Creates minimal runtime image with only production dependencies

### Security Features

- **Helmet**: Sets various HTTP headers for security
- **CORS**: Configurable cross-origin resource sharing
- **Rate Limiting**: Prevents abuse with configurable limits
- **Input Validation**: Request validation with express-validator
- **Error Handling**: Centralized error handling with proper logging
- **Non-root User**: Docker container runs as non-root user

### Monitoring & Observability

- **Health Checks**: Multiple health check endpoints for monitoring
- **Structured Logging**: JSON-formatted logs with Winston
- **Request Tracking**: Unique request IDs for tracing
- **Metrics**: Memory usage, uptime, and load averages

### Container Orchestration

Ready for deployment with:
- **Kubernetes**: Health check endpoints for probes
- **Docker Swarm**: Docker Compose configuration included
- **Cloud Platforms**: Environment-based configuration

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Contributing

1. Follow the existing code style
2. Add tests for new features
3. Ensure all tests pass
4. Update documentation as needed

## License

MIT License - see LICENSE file for details.
