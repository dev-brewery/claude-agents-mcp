FROM node:20-alpine

WORKDIR /app

# Install dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy built files
COPY dist/ ./dist/
COPY data/ ./data/

# Create volume mount point
VOLUME ["/app/data"]

# Set environment
ENV NODE_ENV=production
ENV CONFIG_DATA_PATH=/app/data

# Run the server
CMD ["node", "dist/index.js"]
