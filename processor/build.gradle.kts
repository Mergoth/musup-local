plugins {
    id("org.jetbrains.kotlin.jvm") version "2.3.0"
    id("org.jetbrains.kotlin.plugin.allopen") version "2.3.0"
    id("com.google.devtools.ksp") version "2.3.4"
    id("io.micronaut.application") version "4.6.1"
}

version = "0.1"
group = "com.musup"

repositories {
    mavenCentral()
}

dependencies {
    ksp("io.micronaut:micronaut-http-validation")
    ksp("io.micronaut.serde:micronaut-serde-processor")

    implementation("io.micronaut.kotlin:micronaut-kotlin-runtime")
    implementation("io.micronaut:micronaut-http-client")
implementation("io.micronaut.serde:micronaut-serde-jackson")
    implementation("io.micronaut:micronaut-jackson-databind")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.2")

    runtimeOnly("ch.qos.logback:logback-classic")
    runtimeOnly("org.yaml:snakeyaml")

    testImplementation("io.micronaut.test:micronaut-test-junit5")
    testImplementation("org.mockito.kotlin:mockito-kotlin:5.4.0")
    testImplementation("org.mockito:mockito-core:5.14.2")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

application {
    mainClass = "com.musup.ApplicationKt"
}

java {
    sourceCompatibility = JavaVersion.toVersion("17")
    targetCompatibility = JavaVersion.toVersion("17")
}

tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.fromTarget("17"))
    }
}

graalvmNative.toolchainDetection = false

micronaut {
    version("4.10.8")
    runtime("netty")
    testRuntime("junit5")
    processing {
        incremental(true)
        annotations("com.musup.*")
    }
}
