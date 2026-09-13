FROM node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
WORKDIR /opt/agentproof-scalar
COPY package.json package-lock.json target.mjs ./
COPY node_modules ./node_modules
# The host always overrides this entrypoint with its hashed observer script.
ENTRYPOINT ["node"]
