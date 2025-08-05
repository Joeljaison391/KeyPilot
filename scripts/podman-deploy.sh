#!/bin/bash

# KeyPilot Podman Deployment Script
# This script builds and runs the KeyPilot gateway service using Podman

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="keypilot"
GATEWAY_IMAGE="keypilot-gateway"
REDIS_IMAGE="redis:7-alpine"
NETWORK_NAME="keypilot-network"
REDIS_VOLUME="keypilot-redis-data"
LOGS_VOLUME="keypilot-logs"

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Function to check if Podman is installed
check_podman() {
    if ! command -v podman &> /dev/null; then
        print_error "Podman is not installed. Please install Podman first."
        echo "On macOS: brew install podman"
        echo "On Linux: Check your distribution's package manager"
        exit 1
    fi
    print_status "Podman found: $(podman --version)"
}

# Function to check if podman-compose is available
check_podman_compose() {
    if command -v podman-compose &> /dev/null; then
        print_status "podman-compose found: $(podman-compose --version)"
        return 0
    elif command -v docker-compose &> /dev/null; then
        print_warning "Using docker-compose with podman (DOCKER_HOST will be set)"
        export DOCKER_HOST="unix://$(podman info --format '{{.Host.RemoteSocket.Path}}')"
        return 0
    else
        print_error "Neither podman-compose nor docker-compose found."
        print_error "Install podman-compose: pip install podman-compose"
        return 1
    fi
}

# Function to create network
create_network() {
    print_step "Creating Podman network..."
    if ! podman network exists "$NETWORK_NAME" 2>/dev/null; then
        podman network create "$NETWORK_NAME"
        print_status "Network '$NETWORK_NAME' created"
    else
        print_status "Network '$NETWORK_NAME' already exists"
    fi
}

# Function to create volumes
create_volumes() {
    print_step "Creating Podman volumes..."
    
    if ! podman volume exists "$REDIS_VOLUME" 2>/dev/null; then
        podman volume create "$REDIS_VOLUME"
        print_status "Volume '$REDIS_VOLUME' created"
    else
        print_status "Volume '$REDIS_VOLUME' already exists"
    fi
    
    # Create logs directory if it doesn't exist
    if [ ! -d "./logs" ]; then
        mkdir -p ./logs
        print_status "Logs directory created"
    fi
}

# Function to build the gateway service image
build_gateway() {
    print_step "Building KeyPilot Gateway service..."
    podman build -t "$GATEWAY_IMAGE:latest" -f Dockerfile .
    print_status "Gateway service image built successfully"
}

# Function to run Redis container
run_redis() {
    print_step "Starting Redis container..."
    
    # Stop existing Redis container if running
    if podman ps -a --format "{{.Names}}" | grep -q "keypilot-redis"; then
        print_warning "Stopping existing Redis container..."
        podman stop keypilot-redis >/dev/null 2>&1 || true
        podman rm keypilot-redis >/dev/null 2>&1 || true
    fi
    
    podman run -d \
        --name keypilot-redis \
        --network "$NETWORK_NAME" \
        -p 6379:6379 \
        -v "$REDIS_VOLUME":/data \
        --security-opt no-new-privileges:true \
        --cap-drop ALL \
        --cap-add CHOWN \
        --cap-add SETGID \
        --cap-add SETUID \
        --restart unless-stopped \
        --health-cmd "redis-cli ping" \
        --health-interval 10s \
        --health-timeout 3s \
        --health-retries 3 \
        --health-start-period 10s \
        "$REDIS_IMAGE" \
        redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy allkeys-lru
    
    print_status "Redis container started"
}

# Function to wait for Redis to be healthy
wait_for_redis() {
    print_step "Waiting for Redis to be healthy..."
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if podman healthcheck run keypilot-redis >/dev/null 2>&1; then
            print_status "Redis is healthy"
            return 0
        fi
        
        print_warning "Waiting for Redis... (attempt $attempt/$max_attempts)"
        sleep 2
        attempt=$((attempt + 1))
    done
    
    print_error "Redis failed to become healthy"
    return 1
}

# Function to run gateway service container
run_gateway() {
    print_step "Starting KeyPilot Gateway service..."
    
    # Stop existing gateway container if running
    if podman ps -a --format "{{.Names}}" | grep -q "keypilot-gateway"; then
        print_warning "Stopping existing Gateway container..."
        podman stop keypilot-gateway >/dev/null 2>&1 || true
        podman rm keypilot-gateway >/dev/null 2>&1 || true
    fi
    
    podman run -d \
        --name keypilot-gateway \
        --network "$NETWORK_NAME" \
        -p 3000:3000 \
        -v "$(pwd)/logs:/usr/src/app/logs:Z" \
        --security-opt no-new-privileges:true \
        --cap-drop ALL \
        --cap-add CHOWN \
        --cap-add SETGID \
        --cap-add SETUID \
        --read-only \
        --tmpfs /tmp:noexec,nosuid,size=100m \
        --tmpfs /usr/src/app/logs:noexec,nosuid,size=100m \
        --restart unless-stopped \
        --health-cmd "node scripts/health-check.js" \
        --health-interval 30s \
        --health-timeout 10s \
        --health-retries 3 \
        --health-start-period 40s \
        -e NODE_ENV=production \
        -e PORT=3000 \
        -e APP_NAME=keypilot-gateway \
        -e APP_VERSION=1.0.0 \
        -e REDIS_URL=redis://keypilot-redis:6379 \
        "$GATEWAY_IMAGE:latest"
    
    print_status "Gateway service container started"
}

# Function to show container status
show_status() {
    print_step "Container Status:"
    echo ""
    podman ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
    
    print_step "Health Status:"
    echo "Redis: $(podman inspect keypilot-redis --format '{{.State.Health.Status}}' 2>/dev/null || echo 'Not available')"
    echo "Gateway: $(podman inspect keypilot-gateway --format '{{.State.Health.Status}}' 2>/dev/null || echo 'Not available')"
    echo ""
    
    print_status "KeyPilot Gateway API available at: http://localhost:3000"
    print_status "Health endpoint: http://localhost:3000/health"
    print_status "Redis available at: localhost:6379"
}

# Function to show logs
show_logs() {
    echo ""
    print_step "Recent logs from Gateway service:"
    podman logs --tail 20 keypilot-gateway 2>/dev/null || print_warning "Gateway container not running"
    
    echo ""
    print_step "Recent logs from Redis:"
    podman logs --tail 10 keypilot-redis 2>/dev/null || print_warning "Redis container not running"
}

# Function to stop all containers
stop_all() {
    print_step "Stopping all KeyPilot containers..."
    
    podman stop keypilot-gateway >/dev/null 2>&1 || true
    podman stop keypilot-redis >/dev/null 2>&1 || true
    
    print_status "All containers stopped"
}

# Function to clean up everything
cleanup() {
    print_step "Cleaning up KeyPilot containers and resources..."
    
    # Stop and remove containers
    podman stop keypilot-gateway keypilot-redis >/dev/null 2>&1 || true
    podman rm keypilot-gateway keypilot-redis >/dev/null 2>&1 || true
    
    # Remove volumes (optional)
    read -p "Do you want to remove data volumes? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        podman volume rm "$REDIS_VOLUME" >/dev/null 2>&1 || true
        print_status "Volumes removed"
    fi
    
    # Remove network
    podman network rm "$NETWORK_NAME" >/dev/null 2>&1 || true
    
    # Remove image (optional)
    read -p "Do you want to remove the gateway image? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        podman rmi "$GATEWAY_IMAGE:latest" >/dev/null 2>&1 || true
        print_status "Gateway image removed"
    fi
    
    print_status "Cleanup completed"
}

# Function to use podman-compose
use_compose() {
    if check_podman_compose; then
        print_step "Using compose method..."
        
        case "$1" in
            "up")
                podman-compose -f podman-compose.yml up -d --build
                ;;
            "down")
                podman-compose -f podman-compose.yml down
                ;;
            "logs")
                podman-compose -f podman-compose.yml logs -f
                ;;
            *)
                print_error "Unknown compose command: $1"
                return 1
                ;;
        esac
    else
        return 1
    fi
}

# Main execution
main() {
    case "$1" in
        "build")
            check_podman
            build_gateway
            ;;
        "start"|"up")
            check_podman
            create_network
            create_volumes
            build_gateway
            run_redis
            wait_for_redis
            run_gateway
            sleep 5
            show_status
            ;;
        "stop")
            check_podman
            stop_all
            ;;
        "status")
            check_podman
            show_status
            ;;
        "logs")
            check_podman
            show_logs
            ;;
        "restart")
            check_podman
            stop_all
            sleep 2
            create_network
            create_volumes
            run_redis
            wait_for_redis
            run_gateway
            sleep 5
            show_status
            ;;
        "cleanup")
            check_podman
            cleanup
            ;;
        "compose-up")
            use_compose "up"
            ;;
        "compose-down")
            use_compose "down"
            ;;
        "compose-logs")
            use_compose "logs"
            ;;
        "help"|"--help"|"-h")
            echo "KeyPilot Podman Deployment Script"
            echo ""
            echo "Usage: $0 [COMMAND]"
            echo ""
            echo "Commands:"
            echo "  build         Build the gateway service image"
            echo "  start|up      Build and start all services"
            echo "  stop          Stop all running containers"
            echo "  restart       Restart all services"
            echo "  status        Show container status and health"
            echo "  logs          Show recent logs from containers"
            echo "  cleanup       Stop and remove all containers, networks, and optionally volumes"
            echo "  compose-up    Use podman-compose to start services"
            echo "  compose-down  Use podman-compose to stop services"
            echo "  compose-logs  Use podman-compose to show logs"
            echo "  help          Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 start      # Build and start KeyPilot services"
            echo "  $0 logs       # View recent logs"
            echo "  $0 status     # Check service health"
            echo "  $0 cleanup    # Clean up everything"
            ;;
        *)
            print_error "Unknown command: $1"
            echo "Use '$0 help' for usage information"
            exit 1
            ;;
    esac
}

# Check if running as root (not recommended)
if [ "$EUID" -eq 0 ]; then
    print_warning "Running as root is not recommended for Podman"
    print_warning "Consider running as a regular user"
fi

# Run main function with all arguments
main "$@"
