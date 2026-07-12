FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy rest of the frontend code
COPY . .

# Expose Expo Web port
EXPOSE 8081

# Command to run Expo in web mode
CMD ["npx", "expo", "start", "--web", "--clear"]
