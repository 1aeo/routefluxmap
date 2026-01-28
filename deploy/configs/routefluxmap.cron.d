# RouteFluxMap cron jobs - managed via /etc/cron.d/
# Update: sudo ./deploy/scripts/cron-manage.sh install
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
MAILTO=""
0 */4 * * * ${CRON_USER} ${DEPLOY_DIR}/scripts/update.sh >> ${DEPLOY_DIR}/logs/update.log 2>&1
