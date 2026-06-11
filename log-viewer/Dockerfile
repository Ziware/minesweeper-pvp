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

# Expose the port
EXPOSE 5174

# Start the server with log sync. Run explicitly through sh so Alpine does not depend on the script shebang.
CMD ["sh", "/app/start.sh"]