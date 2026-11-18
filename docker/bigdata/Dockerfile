# One image for every Hadoop-ecosystem service: Hadoop, Hive, Flume and Sqoop share the
# same Hadoop libraries and configuration, so they are installed together and each
# container picks its role at start-up (see roles/).
FROM eclipse-temurin:8-jdk-jammy

ENV HADOOP_HOME=/opt/hadoop \
    HIVE_HOME=/opt/hive \
    FLUME_HOME=/opt/flume \
    SQOOP_HOME=/opt/sqoop \
    PROJECT_HOME=/opt/project
ENV HADOOP_CONF_DIR=${HADOOP_HOME}/etc/hadoop \
    HADOOP_COMMON_HOME=${HADOOP_HOME} \
    HADOOP_HDFS_HOME=${HADOOP_HOME} \
    HADOOP_MAPRED_HOME=${HADOOP_HOME} \
    HADOOP_YARN_HOME=${HADOOP_HOME} \
    PATH=${HADOOP_HOME}/bin:${HADOOP_HOME}/sbin:${HIVE_HOME}/bin:${FLUME_HOME}/bin:${SQOOP_HOME}/bin:${PATH} \
    TZ=UTC

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl python3 procps \
 && rm -rf /var/lib/apt/lists/*

# Declared after the apt layer: every RUN below an ARG depends on it, so changing a
# version, mirror or checksum must not invalidate the system-package cache.
ARG HADOOP_VERSION=3.3.6
ARG HIVE_VERSION=3.1.3
ARG FLUME_VERSION=1.9.0
ARG SQOOP_VERSION=1.4.7
ARG MYSQL_CONNECTOR_VERSION=8.0.33
ARG COMMONS_LANG_VERSION=2.6
ARG MAVEN_CENTRAL=https://repo1.maven.org/maven2

# Tried in order: the Apache CDN (fast, current releases only), a full mirror of older
# releases, then the official archive (complete, but throttled to ~100 KB/s).
ARG APACHE_MIRRORS="https://dlcdn.apache.org https://mirrors.huaweicloud.com/apache https://archive.apache.org/dist"

# Official checksums published on archive.apache.org; the mirror copies are verified against them.
ARG HADOOP_CHECKSUM=sha512:de3eaca2e0517e4b569a88b63c89fae19cb8ac6c01ff990f1ff8f0cc0f3128c8e8a23db01577ca562a0e0bb1b4a3889f8c74384e609cd55e537aada3dcaa9f8a
ARG HIVE_CHECKSUM=sha256:0c9b6a6359a7341b6029cc9347435ee7b379f93846f779d710b13f795b54bb16
ARG FLUME_CHECKSUM=sha512:a989c50389c779dd7554c98bdba687fa982d6079d308c85ac210d3e523aa54b4b7452f38fe30d9acdac327080fe316d604b5efb0f3943cbacb4839fb2261f535
ARG SQOOP_CHECKSUM=md5:390122c6714fb5a09ec45aff4cbb0052

# One layer per package: a failed download does not discard the ones already cached.
COPY docker/bigdata/fetch-apache.sh /usr/local/bin/fetch-apache
RUN fetch-apache "hadoop/common/hadoop-${HADOOP_VERSION}/hadoop-${HADOOP_VERSION}.tar.gz" "${HADOOP_HOME}" "${HADOOP_CHECKSUM}" \
 && rm -rf "${HADOOP_HOME}/share/doc"
RUN fetch-apache "hive/hive-${HIVE_VERSION}/apache-hive-${HIVE_VERSION}-bin.tar.gz" "${HIVE_HOME}" "${HIVE_CHECKSUM}"
RUN fetch-apache "flume/${FLUME_VERSION}/apache-flume-${FLUME_VERSION}-bin.tar.gz" "${FLUME_HOME}" "${FLUME_CHECKSUM}" \
 && rm -rf "${FLUME_HOME}/docs"
RUN fetch-apache "sqoop/${SQOOP_VERSION}/sqoop-${SQOOP_VERSION}.bin__hadoop-2.6.0.tar.gz" "${SQOOP_HOME}" "${SQOOP_CHECKSUM}" \
 && rm -rf "${SQOOP_HOME}/docs"

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Library fixes needed to run these releases together on Hadoop 3.3:
#  - Hive and Flume ship Guava versions older than Hadoop's; use Hadoop's copy everywhere.
#  - Sqoop 1.4.7 still needs commons-lang 2, which Hadoop 3 no longer provides.
#  - Hive, Sqoop need the MySQL JDBC driver.
RUN hadoop_guava=$(ls "${HADOOP_HOME}"/share/hadoop/common/lib/guava-*-jre.jar) \
 && rm -f "${HIVE_HOME}"/lib/guava-*.jar "${FLUME_HOME}"/lib/guava-*.jar \
 && cp "${hadoop_guava}" "${HIVE_HOME}/lib/" \
 && cp "${hadoop_guava}" "${FLUME_HOME}/lib/" \
 && curl -fsSL --retry 3 -o "${SQOOP_HOME}/lib/commons-lang-${COMMONS_LANG_VERSION}.jar" \
      "${MAVEN_CENTRAL}/commons-lang/commons-lang/${COMMONS_LANG_VERSION}/commons-lang-${COMMONS_LANG_VERSION}.jar" \
 && curl -fsSL --retry 3 -o "${HIVE_HOME}/lib/mysql-connector-j-${MYSQL_CONNECTOR_VERSION}.jar" \
      "${MAVEN_CENTRAL}/com/mysql/mysql-connector-j/${MYSQL_CONNECTOR_VERSION}/mysql-connector-j-${MYSQL_CONNECTOR_VERSION}.jar" \
 && cp "${HIVE_HOME}/lib/mysql-connector-j-${MYSQL_CONNECTOR_VERSION}.jar" "${SQOOP_HOME}/lib/"

# Python clients of architecture B: the Kafka producer/writer and the MySQL checks.
# A layer of its own after the downloads, so changing it never fetches Hadoop or Hive again.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3-pip \
 && rm -rf /var/lib/apt/lists/* \
 && pip3 install --no-cache-dir confluent-kafka==2.6.1 'PyMySQL[rsa]==1.1.1'

COPY config/hadoop/ ${HADOOP_CONF_DIR}/
COPY config/hive/hive-site.xml ${HIVE_HOME}/conf/
COPY docker/bigdata/entrypoint.sh /usr/local/bin/entrypoint
COPY docker/bigdata/roles/ /usr/local/lib/bigdata/roles/
COPY scripts/lib/common.sh /usr/local/lib/bigdata/common.sh

# Hadoop 3 refuses to start its daemons as root, so everything runs as "hadoop".
# Installations stay root-owned and read-only; only state and log folders are writable
# (a recursive chown of /opt would duplicate every installed file in a new layer).
RUN useradd --create-home --shell /bin/bash hadoop \
 && mkdir -p /var/lib/hadoop /var/lib/flume /var/log/hadoop /data/live /data/runs \
 && chown hadoop:hadoop /var/lib/hadoop /var/lib/flume /var/log/hadoop /data/live /data/runs
ENV HADOOP_LOG_DIR=/var/log/hadoop

USER hadoop
WORKDIR /home/hadoop
ENTRYPOINT ["entrypoint"]
