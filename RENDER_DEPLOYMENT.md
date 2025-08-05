# KeyPilot Render Deployment Guide

This guide helps you deploy KeyPilot to Render using Docker and Infrastructure as Code.

## Prerequisites

1. **Render Account**: Sign up at [render.com](https://render.com)
2. **GitHub Repository**: KeyPilot code should be in a GitHub repository
3. **Docker**: Ensure your Dockerfile works locally

## Deployment Options

### Option 1: Infrastructure as Code (Recommended)

Using the `render.yaml` file for automated deployment:

1. **Push the render.yaml file** to your repository root or gateway-service directory
2. **Connect to Render**:
   - Go to Render Dashboard
   - Click "New" → "Blueprint"
   - Connect your GitHub repository
   - Select the repository containing `render.yaml`
   - Render will automatically create all services

### Option 2: Manual Service Creation

If you prefer manual setup:

#### Step 1: Create Redis Database
1. Go to Render Dashboard
2. Click "New" → "Redis"
3. Configure:
   - **Name**: `keypilot-redis`
   - **Plan**: Starter (free) or Standard (production)
   - **Region**: Choose closest to your users

#### Step 2: Create Web Service
1. Click "New" → "Web Service"
2. Connect your GitHub repository
3. Configure:
   - **Name**: `keypilot-gateway`
   - **Runtime**: Docker
   - **Root Directory**: `gateway-service` (if applicable)
   - **Docker Command**: Leave empty (uses Dockerfile CMD)
   - **Plan**: Starter (free) or Standard (production)

## Environment Variables

Set these in your Render service settings:

### Required Variables
```bash
NODE_ENV=production
PORT=3000  # Render automatically sets this
APP_NAME=keypilot-gateway
APP_VERSION=1.0.0
REDIS_URL=<automatically-set-by-render>
```

### Security Variables (Generate Strong Values)
```bash
SESSION_SECRET=<generate-32-char-random-string>
JWT_SECRET=<generate-32-char-random-string>
ENCRYPTION_KEY=<generate-32-char-random-string>
```

### Optional API Keys (Set in Dashboard for Security)
```bash
GEMINI_API_KEY=<your-gemini-api-key>
OPENAI_API_KEY=<your-openai-api-key>
ANTHROPIC_API_KEY=<your-anthropic-api-key>
```

## Security Best Practices

### 1. Environment Variables
- Never commit secrets to your repository
- Use Render's environment variable management
- Enable "Sync" only for non-sensitive variables

### 2. Redis Security
- Use Redis IP allowlist in production
- Consider Redis AUTH for additional security
- Monitor Redis usage and set memory limits

### 3. Application Security
- The Dockerfile runs as non-root user
- Security headers are configured in the app
- Regular security updates via Alpine base image

## Monitoring and Maintenance

### Health Checks
- Render automatically monitors `/health` endpoint
- Configure alerts in Render dashboard
- Monitor logs for errors and performance

### Scaling
```yaml
# In render.yaml
numInstances: 1  # Start with 1
plan: starter    # Upgrade to standard/professional as needed
```

### Logs
- View logs in Render dashboard
- Set up log retention policies
- Consider external logging services for production

## Production Deployment Checklist

### Pre-deployment
- [ ] Test Docker build locally
- [ ] Verify all environment variables
- [ ] Test health check endpoint
- [ ] Review security configurations
- [ ] Set up monitoring alerts

### Post-deployment
- [ ] Verify service is running
- [ ] Test API endpoints
- [ ] Check Redis connectivity
- [ ] Monitor performance metrics
- [ ] Set up backup procedures

## Troubleshooting

### Common Issues

#### Build Failures
```bash
# Check Dockerfile syntax
docker build -t keypilot-test .

# Verify dependencies
npm ci && npm run build
```

#### Connection Issues
```bash
# Verify Redis URL format
redis://[username:password@]host:port

# Check network connectivity
curl https://your-app.onrender.com/health
```

#### Memory Issues
```bash
# Monitor Redis memory usage
# Upgrade Redis plan if needed
# Optimize application memory usage
```

### Getting Help

1. **Render Documentation**: [render.com/docs](https://render.com/docs)
2. **Render Support**: Available in dashboard
3. **Application Logs**: Check Render dashboard logs
4. **Health Check**: Visit `/health` endpoint

## Cost Optimization

### Free Tier Limitations
- **Web Service**: 750 hours/month, sleeps after 15min inactivity
- **Redis**: 25MB storage, shared resources
- **Bandwidth**: 100GB/month

### Production Recommendations
- Upgrade to Standard plans for always-on services
- Use Professional plans for high-traffic applications  
- Monitor usage and costs in dashboard
- Consider reserved instances for predictable workloads

## Continuous Deployment

### Auto-deploy Setup
```yaml
# In render.yaml
autoDeploy: true
branch: main
```

### Manual Deployment
1. Push changes to your repository
2. Render automatically detects changes
3. Builds and deploys new version
4. Zero-downtime deployment

### Rollback Procedure
1. Go to Render dashboard
2. Select your service
3. Click "Deployments" tab
4. Click "Rollback" on previous deployment

## Advanced Configuration

### Custom Domains
1. Add custom domain in Render dashboard
2. Configure DNS records
3. SSL certificates are automatically managed

### Multiple Environments
```yaml
# render.yaml supports multiple services
services:
  - name: keypilot-staging
    branch: develop
  - name: keypilot-production  
    branch: main
```

### Performance Tuning
- Use Standard or Professional plans
- Enable HTTP/2 and compression
- Optimize Redis configuration
- Monitor and profile application performance
