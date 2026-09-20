ARG MAINTAINERR_IMAGE=local/maintainerr-integration:fad7010
FROM ${MAINTAINERR_IMAGE}
COPY --chown=node:node tools/cantinarr-retention-lab/ /opt/cantinarr-retention-lab/
ENTRYPOINT ["node", "/opt/cantinarr-retention-lab/worker.cjs"]
CMD []
HEALTHCHECK NONE
