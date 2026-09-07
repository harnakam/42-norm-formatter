#ifndef SAMPLE_H
#define SAMPLE_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_NAME_LEN 64
#define MAX_USERS 128
#define BUFFER_SIZE 256

typedef struct s_user
{
int id;
char name[MAX_NAME_LEN];
int age;
double score;
}t_user;

typedef struct s_database
{
t_user users[MAX_USERS];
int count;
}t_database;

void init_database(t_database *db);
int add_user(t_database *db,const char *name,int age,double score);
void print_user(const t_user *user);
void print_database(const t_database *db);
t_user *find_user_by_id(t_database *db,int id);
void remove_user_by_id(t_database *db,int id);
void update_score(t_database *db,int id,double score);
int load_users_from_file(t_database *db,const char *filename);
int save_users_to_file(const t_database *db,const char *filename);

int sum_array(int *arr,int size);
double average_array(int *arr,int size);

void bubble_sort(int *arr,int size);
void reverse_string(char *str);

#endif
