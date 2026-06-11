FROM node:18-alpine

WORKDIR /app

# Install rsync, SSH client, and bash for compatibility with previously built scripts/images.
RUN apk add --no-cache rsync openssh-client bash

# Copy log viewer files
COPY . .

# Create logs directory
RUN mkdir -p logs

# Create SSH directory
RUN mkdir -p /root/.ssh

RUN chmod +x start.sh

# Expose the port
EXPOSE 5174

# Start the server with log sync. Run through sh so Alpine does not need bash.
CMD ["./start.sh"]