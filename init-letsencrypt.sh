#!/bin/bash

if ! [ -x "$(command -v docker-compose)" ]; then
  if ! [ -x "$(command -v docker)" ]; then
    echo 'Error: docker is not installed.' >&2
    exit 1
  fi
  DOCKER_COMPOSE="docker compose"
else
  DOCKER_COMPOSE="docker-compose"
fi

domains=(app.oyuns.mn dashboard.oyuns.mn)
primary_domain="${domains[0]}"
rsa_key_size=4096
data_path="./certbot"
email="" # Adding a valid address is strongly recommended
staging=0 # Set to 1 iifif you're testing your setup to avoid hitting request limits

create_dummy_certificate() {
  echo "### Creating dummy certificate for ${domains[*]} ..."
  path="/etc/letsencrypt/live/$primary_domain"
  mkdir -p "$data_path/conf/live/$primary_domain"
  $DOCKER_COMPOSE run --rm --entrypoint "\
    openssl req -x509 -nodes -newkey rsa:$rsa_key_size -days 1\
      -keyout '$path/privkey.pem' \
      -out '$path/fullchain.pem' \
      -subj '/CN=localhost'" certbot
  echo
}

if [ -d "$data_path" ]; then
  read -p "Existing data found for ${domains[*]}. Continue and replace existing certificate? (y/N) " decision
  if [ "$decision" != "Y" ] && [ "$decision" != "y" ]; then
    exit
  fi
fi


if [ ! -e "$data_path/conf/options-ssl-nginx.conf" ] || [ ! -e "$data_path/conf/ssl-dhparams.pem" ]; then
  echo "### Downloading recommended TLS parameters ..."
  mkdir -p "$data_path/conf"
  curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf > "$data_path/conf/options-ssl-nginx.conf"
  curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem > "$data_path/conf/ssl-dhparams.pem"
  echo
fi

create_dummy_certificate


echo "### Starting nginx ..."
$DOCKER_COMPOSE up --force-recreate -d nginx
echo

echo "### Deleting dummy certificate ..."
$DOCKER_COMPOSE run --rm --entrypoint "\
  rm -Rf /etc/letsencrypt/live/$primary_domain && \
  rm -Rf /etc/letsencrypt/archive/$primary_domain && \
  rm -Rf /etc/letsencrypt/renewal/$primary_domain.conf" certbot
echo


echo "### Requesting Let's Encrypt certificate for ${domains[*]} ..."
#Join $domains to -d args
domain_args=""
for domain in "${domains[@]}"; do
  domain_args="$domain_args -d $domain"
done

# Select appropriate email arg
case "$email" in
  "") email_arg="--register-unsafely-without-email" ;;
  *) email_arg="-m $email" ;;
esac

# Enable staging mode if needed
if [ $staging != "0" ]; then staging_arg="--staging"; fi

set +e
$DOCKER_COMPOSE run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot \
    $email_arg \
    $domain_args \
    --rsa-key-size $rsa_key_size \
    --agree-tos \
    $staging_arg \
    --force-renewal" certbot
certbot_status=$?
set -e
echo

if [ $certbot_status -ne 0 ]; then
  create_dummy_certificate
  echo "### Certbot failed; skipping nginx reload so the current process keeps serving." >&2
  echo "### Fix the ACME challenge path or DNS/port routing, then rerun ./init-letsencrypt.sh" >&2
  exit $certbot_status
fi

echo "### Reloading nginx ..."
$DOCKER_COMPOSE exec nginx nginx -s reload
