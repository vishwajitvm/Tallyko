# Build container only for packaging and building APK/IPA in CI/CD pipeline
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Stub command for build verification
CMD ["npm", "run", "lint"]
