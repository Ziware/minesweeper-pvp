FROM node:18-alpine

WORKDIR /app

# Install rsync and SSH client
RUN apk add --no-cache rsync openssh-client

# Copy log viewer files
COPY . .

# Create logs directory
RUN mkdir -p logs

# Create SSH directory
RUN mkdir -p /root/.ssh

RUN chmod +x start.sh

# Expose the port
EXPOSE 5174

# Start the server with log sync
CMD ["./start.sh"]