#!/bin/bash

# KeyPilot Render Deployment Helper Script
# This script helps prepare and deploy KeyPilot to Render

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

echo "🚀 KeyPilot Render Deployment Helper"
echo "===================================="
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    print_warning "package.json not found. Make sure you're in the gateway-service directory."
    exit 1
fi

print_step "1. Testing Docker build locally..."
if docker build -t keypilot-render-test -f Dockerfile.render . > /dev/null 2>&1; then
    print_status "✅ Docker build successful"
    docker rmi keypilot-render-test > /dev/null 2>&1
else
    print_warning "❌ Docker build failed. Please fix Dockerfile issues first."
    exit 1
fi

print_step "2. Checking required files..."

# Check for render.yaml
if [ -f "render.yaml" ]; then
    print_status "✅ render.yaml found"
else
    print_warning "❌ render.yaml not found"
fi

# Check for Dockerfile.render
if [ -f "Dockerfile.render" ]; then
    print_status "✅ Dockerfile.render found"
else
    print_warning "❌ Dockerfile.render not found"
fi

# Check for health check script
if [ -f "scripts/health-check.js" ]; then
    print_status "✅ Health check script found"
else
    print_warning "❌ Health check script not found"
fi

print_step "3. Generating environment variable template..."
cat > .env.render.template << 'EOF'
# KeyPilot Render Environment Variables
# Copy these to your Render service settings

# Application Settings
NODE_ENV=production
PORT=3000
APP_NAME=keypilot-gateway
APP_VERSION=1.0.0

# Redis (automatically set by Render when you connect Redis service)
# REDIS_URL=redis://username:password@host:port

# Security Secrets (Generate strong random values - DO NOT use these examples)
SESSION_SECRET=GENERATE_32_CHAR_RANDOM_STRING_HERE
JWT_SECRET=GENERATE_32_CHAR_RANDOM_STRING_HERE  
ENCRYPTION_KEY=GENERATE_32_CHAR_RANDOM_STRING_HERE

# Optional: External API Keys (Set these in Render Dashboard for security)
# GEMINI_API_KEY=your_gemini_api_key_here
# OPENAI_API_KEY=your_openai_api_key_here
# ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Optional: Additional Configuration
# LOG_LEVEL=info
# CORS_ORIGIN=https://yourdomain.com
# RATE_LIMIT_WINDOW_MS=900000
# RATE_LIMIT_MAX_REQUESTS=100
EOF

print_status "✅ Environment template created: .env.render.template"

print_step "4. Deployment checklist..."
echo ""
echo "📋 Pre-deployment Checklist:"
echo "   □ Push your code to GitHub"
echo "   □ Create Render account at render.com"
echo "   □ Generate strong secrets for SESSION_SECRET, JWT_SECRET, ENCRYPTION_KEY"
echo "   □ Review render.yaml configuration"
echo "   □ Test health check endpoint locally: npm start && curl localhost:3000/health"
echo ""

print_step "5. Deployment Instructions:"
echo ""
echo "🎯 Option 1 - Infrastructure as Code (Recommended):"
echo "   1. Push render.yaml to your repository"
echo "   2. Go to Render Dashboard → New → Blueprint"
echo "   3. Connect your GitHub repository"
echo "   4. Render will create all services automatically"
echo ""

echo "🎯 Option 2 - Manual Setup:"
echo "   1. Create Redis service first"
echo "   2. Create Web service with Docker runtime"
echo "   3. Set environment variables from .env.render.template"
echo "   4. Connect Redis to Web service"
echo ""

print_step "6. Post-deployment verification:"
echo ""
echo "✅ After deployment, verify:"
echo "   • Service is running: Check Render dashboard"
echo "   • Health check: https://your-app.onrender.com/health"
echo "   • API endpoints: Test your proxy endpoints"
echo "   • Redis connection: Check logs for Redis connectivity"
echo "   • Monitor logs: Watch for any errors or warnings"
echo ""

print_status "🎉 Ready for Render deployment!"
print_warning "📖 For detailed instructions, see RENDER_DEPLOYMENT.md"

echo ""
echo "🔗 Useful Links:"
echo "   • Render Dashboard: https://dashboard.render.com"
echo "   • Render Docs: https://render.com/docs"
echo "   • KeyPilot Repository: Update render.yaml with your repo URL"
echo ""

# Generate secrets helper
print_step "7. Generating sample secrets (for reference only)..."
echo ""
echo "🔐 Sample secrets (GENERATE YOUR OWN for production):"
echo "SESSION_SECRET=$(openssl rand -hex 32 2>/dev/null || echo 'GENERATE_YOUR_OWN_32_CHAR_SECRET')"
echo "JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || echo 'GENERATE_YOUR_OWN_32_CHAR_SECRET')"
echo "ENCRYPTION_KEY=$(openssl rand -hex 16 2>/dev/null || echo 'GENERATE_YOUR_OWN_16_CHAR_KEY')"
echo ""
print_warning "⚠️  DO NOT use these sample secrets in production!"

print_status "Deployment preparation complete! 🚀"
