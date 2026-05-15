FROM eclipse-temurin:25-jre

WORKDIR /app

COPY build/install/musup-processor/ ./

COPY src/main/resources/logback.xml /app/config/logback.xml
COPY src/main/resources/application.yml /app/config/application.yml

RUN chmod +x bin/musup-processor

ENV MICRONAUT_CONFIG_FILES=/app/config/application.yml
ENV PORT=8080
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75 -Dlogback.configurationFile=/app/config/logback.xml"

EXPOSE 8080

CMD ["bin/musup-processor"]
