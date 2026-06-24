bun build --compile ./index.ts --outfile bungee-service

gcloud beta run deploy bungee-service --source . --no-build --base-image=osonly24 --command=./bungee-service --project $GOOGLE_CLOUD_PROJECT --region $GOOGLE_CLOUD_LOCATION --allow-unauthenticated
