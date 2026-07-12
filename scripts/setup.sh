#!/bin/bash
# Local environment bootstrap script for Tallyko

echo "Bootstrapping local environment..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
else
  echo ".env already exists."
fi

if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  echo "Created backend/.env from backend/.env.example"
fi

if [ ! -f frontend/.env ]; then
  cp frontend/.env.example frontend/.env
  echo "Created frontend/.env from frontend/.env.example"
fi

echo "Environment initialized successfully. Run dev.sh to start containers."
