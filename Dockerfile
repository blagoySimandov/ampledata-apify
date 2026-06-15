FROM apify/actor-node:20

COPY package*.json ./

RUN npm --quiet set progress=false \
    && npm install --include=dev --audit=false \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version

COPY . ./

RUN npm run build

RUN npm prune --omit=dev

CMD ["npm", "run", "start", "--silent"]
